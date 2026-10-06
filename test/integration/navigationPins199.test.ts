import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createError } from 'h3'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { AuthTokenPayload } from '../../server/utils/auth'
let fixture: TestDb, owner: postgres.Sql, connection: typeof import('../../server/db'), pins: typeof import('../../server/utils/navigationPins')
let a: AuthTokenPayload, b: AuthTokenPayload, other: AuthTokenPayload
const entities: string[] = []
beforeAll(async () => {
  vi.stubGlobal('createError', createError)
  fixture = await createTestDb(); owner = postgres(fixture.ownerUrl, { onnotice: () => {} })
  vi.stubEnv('APP_DATABASE_URL', fixture.appUrl)
  connection = await import('../../server/db'); pins = await import('../../server/utils/navigationPins')
  async function user(tenantId: string, roleId: string) {
    const person = randomUUID(), id = randomUUID()
    await owner`insert into people(id,email,password_hash) values (${person},${person+'@local.test'},'!synthetic')`
    await owner`insert into users(id,tenant_id,person_id,role_id) values (${id},${tenantId},${person},${roleId})`
    return { sub: id, tenantId, roleId } as AuthTokenPayload
  }
  const tenant = randomUUID(), tenantB = randomUUID(), role = randomUUID(), roleB = randomUUID()
  await owner`insert into tenants(id,name,slug) values (${tenant},'A sintética',${tenant}),(${tenantB},'B sintética',${tenantB})`
  await owner`insert into roles(id,tenant_id,name,is_system) values (${role},${tenant},'Administrador',true),(${roleB},${tenantB},'Administrador',true)`
  a = await user(tenant,role); b = await user(tenant,role); other = await user(tenantB,roleB)
  for (let i=0;i<13;i++) {
    const entity = randomUUID(); entities.push(entity)
    await owner`insert into entities(id,tenant_id,name,slug) values (${entity},${tenant},${'Módulo '+i},${'pin-module-'+i})`
    await owner`insert into role_entity_permissions(role_id,entity_id,can_read,can_create,show_in_menu) values (${role},${entity},true,${i%2===0},true)`
  }
},120000)
afterEach(async () => {
  await owner`delete from navigation_pins`
  await owner`delete from tenant_apps`
})
afterAll(async () => { await connection?.client.end(); await owner?.end(); await fixture?.stop(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('migra como propietario no superusuario y runtime sin BYPASSRLS',async () => {
  expect((await owner`select rolsuper from pg_roles where rolname=current_user`)[0]!.rolsuper).toBe(false)
  expect((await connection.client`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`)[0]).toMatchObject({ rolsuper:false,rolbypassrls:false })
})
it('ancla, persiste, no duplica y desancla sin tocar otros usuarios u organizaciones',async () => {
  expect(await pins.changeNavigationPin(a,'sites:all',true)).toEqual({ keys:['sites:all'] })
  await pins.changeNavigationPin(a,'sites:all',true)
  expect(await pins.readNavigationPins(a)).toEqual({ keys:['sites:all'] })
  expect(await pins.readNavigationPins(b)).toEqual({ keys:[] }); expect(await pins.readNavigationPins(other)).toEqual({ keys:[] })
  await pins.changeNavigationPin(b,'sites:pages',true); await pins.changeNavigationPin(other,'sites:all',true)
  await pins.changeNavigationPin(a,'sites:all',false)
  expect(await pins.readNavigationPins(a)).toEqual({ keys:[] }); expect(await pins.readNavigationPins(b)).toEqual({ keys:['sites:pages'] }); expect(await pins.readNavigationPins(other)).toEqual({ keys:['sites:all'] })
})
it('RLS aísla usuario y tenant incluso sin WHERE; rechaza insertar para otro usuario',async () => {
  await pins.changeNavigationPin(a,'sites:all',true); await pins.changeNavigationPin(b,'sites:pages',true)
  const rows = await connection.withTenant(a.tenantId,async tx => { await tx.execute(sql`select set_config('app.nav_user_id',${a.sub},true)`); return tx.execute(sql`select item_key from navigation_pins`) })
  expect(rows.map(row => row.item_key)).toEqual(['sites:all'])
  expect(await connection.withTenant(other.tenantId,async tx => { await tx.execute(sql`select set_config('app.nav_user_id',${a.sub},true)`); return tx.execute(sql`select item_key from navigation_pins`) })).toHaveLength(0)
  await expect(connection.withTenant(a.tenantId,async tx => { await tx.execute(sql`select set_config('app.nav_user_id',${a.sub},true)`); await tx.execute(sql`insert into navigation_pins(tenant_id,user_id,item_key) values (${a.tenantId}::uuid,${b.sub}::uuid,'sites:all')`) })).rejects.toThrow()
})
it('omite destinos huérfanos o bloqueados y no permite anclarlos por API',async () => {
  await pins.changeNavigationPin(a,'sites:all',true)
  await owner`insert into tenant_apps(tenant_id,app_key,enabled) values (${a.tenantId},'sites',false)`
  expect(await pins.readNavigationPins(a)).toEqual({ keys:[] }); await expect(pins.changeNavigationPin(a,'sites:pages',true)).rejects.toMatchObject({ statusCode:403 })
  await pins.changeNavigationPin(a,'entity:'+entities[0],true)
  await owner`update role_entity_permissions set can_read=false where role_id=${a.roleId!} and entity_id=${entities[0]!}`
  expect(await pins.readNavigationPins(a)).toEqual({ keys:[] })
  await owner`update role_entity_permissions set can_read=true where role_id=${a.roleId!} and entity_id=${entities[0]!}`
  await pins.changeNavigationPin(a,'entity:'+entities[1],true)
  await owner`update entities set deleted_at=now() where id=${entities[1]!}`
  expect((await pins.readNavigationPins(a)).keys).not.toContain('entity:'+entities[1])
  await owner`update entities set deleted_at=null where id=${entities[1]!}`
  await expect(pins.changeNavigationPin(a,'entity:'+randomUUID(),true)).rejects.toMatchObject({ statusCode:403 })
})
it('limita a 12 incluso con emisiones concurrentes; libera espacio al desanclar',async () => {
  const results = await Promise.allSettled(entities.map(id => pins.changeNavigationPin(a,'entity:'+id,true)))
  expect(results.filter(result => result.status==='fulfilled')).toHaveLength(12)
  const rejected = results.find(result => result.status==='rejected') as PromiseRejectedResult
  expect(rejected.reason).toMatchObject({ statusCode:409 })
  const saved = await pins.readNavigationPins(a); expect(saved.keys).toHaveLength(12)
  await pins.changeNavigationPin(a,saved.keys[0]!,false)
  await pins.changeNavigationPin(a,'sites:all',true); expect((await pins.readNavigationPins(a)).keys).toHaveLength(12)
})
it('un destino eliminado libera el cupo al anclar otro',async () => {
  for (const id of entities.slice(0,12)) await pins.changeNavigationPin(a,'entity:'+id,true)
  await owner`update entities set deleted_at=now() where id=${entities[0]!}`
  await pins.changeNavigationPin(a,'sites:all',true)
  expect((await pins.readNavigationPins(a)).keys).toHaveLength(12)
  expect((await pins.readNavigationPins(a)).keys).toContain('sites:all')
  await owner`update entities set deleted_at=null where id=${entities[0]!}`
})
