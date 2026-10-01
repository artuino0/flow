import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { AuthTokenPayload } from '../../server/utils/auth'
import { agentPrompt, cheapAgentReply } from '../../server/utils/agent/layers'
import { travelCatalog } from '../fixtures/agentTravelCatalog'
import { validateAgentActions } from '../../utils/chattitoCatalog'
let fixture: TestDb
let admin: postgres.Sql
let db: typeof import('../../server/db')
let read: typeof import('../../server/utils/agent/tenantCatalog').readTenantCatalog
let visible: typeof import('../../server/utils/moduleEntities').listVisibleEntities

async function actor(tenantId: string = randomUUID(), system = false): Promise<AuthTokenPayload> {
 const roleId = randomUUID(), sub = randomUUID(), person = randomUUID()
 await admin`insert into tenants(id,name) values (${tenantId},'Prueba catálogo') on conflict do nothing`
 await admin`insert into roles(id,tenant_id,name,is_system) values (${roleId},${tenantId},${roleId},${system})`
 await admin`insert into people(id,email,password_hash) values (${person},${person + '@test.local'},'sin-contraseña-real')`
 await admin`insert into users(id,tenant_id,person_id,role_id) values (${sub},${tenantId},${person},${roleId})`
 return { tenantId, roleId, sub, sid: randomUUID() }
}
async function entity(auth: AuthTokenPayload, name: string, slug: string, canRead = true, canCreate = true, active = true, deleted = false, moduleKind = 'hecho') {
 const id = randomUUID()
 await admin`insert into entities(id,tenant_id,name,slug,is_active,deleted_at,description,singular_name,module_kind) values (${id},${auth.tenantId},${name},${slug},${active},${deleted ? new Date() : null},${'Descripción\u0001' + 'x'.repeat(400)},${'Singular'.repeat(30)},${moduleKind})`
 await admin`insert into role_entity_permissions(role_id,entity_id,can_read,can_create) values (${auth.roleId!},${id},${canRead},${canCreate})`
 return id
}
beforeAll(async () => {
 vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Red prohibida en ERD-144') }))
 fixture = await createTestDb({ preserveFiles: true })
 admin = postgres(fixture.adminUrl)
 process.env.APP_DATABASE_URL = fixture.appUrl
 db = await import('../../server/db')
 read = (await import('../../server/utils/agent/tenantCatalog')).readTenantCatalog
 visible = (await import('../../server/utils/moduleEntities')).listVisibleEntities
}, 120000)
afterAll(async () => {
 if (db) await db.client.end()
 if (admin) await admin.end()
 if (fixture) await fixture.stop()
 delete process.env.APP_DATABASE_URL
 vi.unstubAllGlobals(); vi.unstubAllEnvs()
}, 120000)
describe('ERD-144 PostgreSQL embebido, RLS y permisos reales', () => {
 it('ERD-147: datos de dyda-travel, administrador y recepcionista con RLS', async () => {
  const user = await actor(undefined, true), receptionist = await actor(user.tenantId), other = await actor()
  for (const item of travelCatalog) {
   const id = await entity(user, item.name, item.slug, true, true, true, false, item.moduleKind)
   if (item.slug === 'citas') await admin`insert into role_entity_permissions(role_id,entity_id,can_read,can_create) values (${receptionist.roleId!},${id},true,false)`
  }
  await entity(other, 'Entidad ajena', 'otro_tenant')
  const available = await read(user)
  expect(available).toHaveLength(11)
  const rights = { isAdmin: true, designerAvailable: true }
  const query = { message: 'que modulos tengo', context: { page: 'home', path: '/' } }
  const first = cheapAgentReply(query, rights, available)!
  expect(first.reply).toContain('4 módulos')
  for (const item of travelCatalog.filter(item => item.moduleKind === 'hecho')) expect(first.reply).toContain(item.name)
  const second = cheapAgentReply({ ...query, message: 'y catalagos', history: [{ role: 'assistant', text: first.reply }] }, rights, available)!
  expect(second.reply).toContain('7 catálogos')
  for (const item of travelCatalog.filter(item => item.moduleKind === 'dimension')) expect(second.reply).toContain(item.name)
  for (const [message, slug] of [['abre cuentas por cobrar', 'cuentas_por_cobrar'], ['abre el catálogo de métodos de pago', 'metodos_pago'], ['cobros de clientes', 'cobros_cliente']]) {
   expect(cheapAgentReply({ ...query, message: message! }, rights, available)?.actions[0]).toMatchObject({ path: `/registros/${slug}` })
  }
  const restricted = await read(receptionist)
  expect(restricted.map(item => item.slug)).toEqual(['citas'])
  expect(cheapAgentReply(query, { isAdmin: false, designerAvailable: false }, restricted)?.reply).toContain('1 módulo: Citas')
  expect(validateAgentActions([{ kind: 'navigate', path: '/registros/citas/nuevo' }, { kind: 'navigate', path: '/registros/cuentas_por_cobrar' }], rights, restricted)).toEqual([])
  expect(validateAgentActions([{ kind: 'navigate', path: '/registros/otro_tenant' }], rights, available)).toEqual([])
 })
 it('ERD-147: omitidos por patrón/longitud/límite, conteo real y log sin nombres ni slugs', async () => {
  const user = await actor()
  for (const slug of ['a?b', 'A B', 'a'.repeat(101)]) await entity(user, 'Nombre sensible', slug)
  for (let i = 0; i < 82; i++) await entity(user, `Entidad${i}`, `entidad_${i}`)
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
   const available = await read(user)
   expect(available).toHaveLength(80)
   expect(available.totalsByKind).toEqual({ hecho: 85 })
   expect(info).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'agent_catalog', catalogSkipped: 5, catalogSkippedReasons: { slug: 3, limit: 2 } }))
   expect(info.mock.calls.flat().join(' ')).not.toMatch(/Nombre sensible|entidad_|a\?b|A B/)
   const reply = cheapAgentReply({ message: 'que modulos tengo', context: { page: 'home', path: '/' } }, { isAdmin: true, designerAvailable: true }, available)!
   expect(reply.reply).toContain('85 módulos'); expect(reply.reply).toContain('y 73 más')
   expect(reply.reply.match(/Entidad\d+/g)).toHaveLength(12)
   const cached = await read(user)
   expect(cached.totalsByKind).toEqual({ hecho: 85 })
   cached.totalsByKind!.hecho = 0
   expect((await read(user)).totalsByKind).toEqual({ hecho: 85 })
  } finally { info.mockRestore() }
 })
 it('adenda: enumera por module_kind y permisos reales sin confundir dimensiones y hechos', async () => {
  const user = await actor(undefined, true), member = await actor(user.tenantId), other = await actor()
  await entity(user, 'Citas', 'citas')
  const services = await entity(user, 'Servicios', 'servicios', true, true, true, false, 'dimension')
  await entity(user, 'Referencia oculta', 'oculta', false, true, true, false, 'dimension')
  await entity(other, 'Catálogo ajeno', 'ajeno', true, true, true, false, 'dimension')
  await admin`insert into role_entity_permissions(role_id,entity_id,can_read,can_create) values (${member.roleId!},${services},true,false)`
  const available = await read(user)
  const query = { message: 'qué catálogos tengo', context: { page: 'home', path: '/' } }
  const rights = { isAdmin: true, designerAvailable: true }
  const catalogs = cheapAgentReply(query, rights, available)!
  expect(catalogs.reply).toContain('1 catálogo'); expect(catalogs.reply).toContain('Servicios')
  expect(catalogs.reply).not.toMatch(/Citas|Referencia oculta|Catálogo ajeno/)
  const operational = cheapAgentReply({ ...query, message: 'qué módulos tengo' }, rights, available)!
  expect(operational.reply).toContain('Citas'); expect(operational.reply).not.toContain('Servicios')
  const memberModules = await read(member)
  expect(memberModules.map(module => module.moduleKind)).toEqual(['dimension'])
  const memberReply = cheapAgentReply({ ...query, message: 'llévame a catálogos' }, { isAdmin: false, designerAvailable: false }, memberModules)!
  expect(memberReply.actions).toEqual([{ kind: 'navigate', path: '/registros/servicios', label: 'Llévame al catálogo Servicios' }])
  const prompt = agentPrompt(query, rights, available)
  expect(JSON.parse(prompt.prompt).untrusted_tenant_catalog).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Servicios', moduleKind: 'dimension', type: 'catálogo' }), expect.objectContaining({ name: 'Citas', moduleKind: 'hecho', type: 'módulo' })]))
  expect(prompt.prompt).not.toMatch(/Referencia oculta|Catálogo ajeno/)
 })
 it('mismo alcance del menú; ocultos, inactivos y borrados no llegan a respuestas ni prompt', async () => {
  const user = await actor(), teammate = await actor(user.tenantId), other = await actor()
  await entity(user, 'Servicios', 'servicios', true, false)
  await entity(user, 'Secreto interno', 'secreto', false)
  await entity(user, 'Inactivo', 'inactivo', true, true, false)
  await entity(user, 'Borrado', 'borrado', true, true, true, true)
  await entity(other, 'Ajeno', 'ajeno')
  const modules = await read(user)
  expect(modules.map(module => module.slug)).toEqual(['servicios'])
  expect(modules.map(module => module.id)).toEqual((await visible(user.tenantId, user.roleId!)).map(module => module.id))
  expect(await read(teammate)).toEqual([])
  expect((await read(other)).map(module => module.slug)).toEqual(['ajeno'])
  const input = { message: 'donde registro servicios', context: { page: 'home', path: '/' } }
  expect(cheapAgentReply(input, { isAdmin: false, designerAvailable: false }, modules)?.actions).toHaveLength(1)
  const prompt = agentPrompt(input, { isAdmin: false, designerAvailable: false }, modules)
  expect(prompt.prompt).not.toMatch(/Secreto interno|Inactivo|Borrado|Ajeno/)
  // RLS real incluso al omitir el filtro explícito de tenant de la consulta.
  const rows = await db.withTenant(user.tenantId, tx => tx.execute(sql`select tenant_id from entities`))
  expect(Array.from(rows).every(row => row.tenant_id === user.tenantId)).toBe(true)
 })
 it('rol de sistema conserva exactamente la visibilidad legible de la aplicación', async () => {
  const user = await actor(undefined, true)
  await entity(user, 'Legible', 'legible')
  await entity(user, 'Sin lectura', 'sin-lectura', false)
  expect((await read(user)).map(module => module.id)).toEqual((await visible(user.tenantId, user.roleId!)).map(module => module.id))
 })
 it('TTL refleja módulos y revocación de permisos, caché separada por organización y rol', async () => {
  vi.stubEnv('AGENT_CATALOG_TTL_MS', '80')
  const user = await actor()
  const id = await entity(user, 'Antes', 'antes')
  const initial = await read(user)
  // El consumidor no puede mutar el caché de otro usuario del mismo rol.
  initial[0]!.name = 'Contaminado'
  await admin`update entities set name='Después' where id=${id}`
  expect((await read(user))[0]?.name).toBe('Antes')
  await new Promise(resolve => setTimeout(resolve, 100))
  expect((await read(user))[0]?.name).toBe('Después')
  await admin`update role_entity_permissions set can_read=false where role_id=${user.roleId!} and entity_id=${id}`
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(await read(user)).toEqual([])
 })
 it('límites SQL: 80 módulos, primeros 12 campos, longitudes y controles saneados', async () => {
  const user = await actor()
  const id = await entity(user, 'A\u0001' + 'x'.repeat(160), 'primero')
  for (let i = 0; i < 15; i++) await admin`insert into entity_fields(entity_id,name,label,data_type,sort_order) values (${id},${'campo' + i},${'Etiqueta ' + i + '\u0001' + 'x'.repeat(100)},'text',${i})`
  for (let i = 0; i < 82; i++) await entity(user, 'Z' + i, 'modulo-' + i)
  const modules = await read(user)
  expect(modules).toHaveLength(80)
  const first = modules.find(module => module.id === id)!
  expect(first.name.length).toBe(100); expect(first.singularName.length).toBe(100); expect(first.description.length).toBe(240)
  expect(first.fieldLabels).toHaveLength(12); expect(first.fieldLabels[0]).toContain('Etiqueta 0'); expect(first.fieldLabels[11]).toContain('Etiqueta 11')
  expect(first.fieldLabels.every(label => label.length <= 60)).toBe(true)
  expect(JSON.stringify(first)).not.toContain('\\u0001')
  expect(Object.keys(first).sort()).toEqual(['canCreate', 'description', 'fieldLabels', 'id', 'moduleKind', 'name', 'singularName', 'slug'])
 })
})
