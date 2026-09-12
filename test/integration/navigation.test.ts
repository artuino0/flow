import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
let testDb: TestDb, admin: postgres.Sql
let save: any, load: any
const tenantA = randomUUID(), tenantB = randomUUID()
let roleA: string, regular: string, entityA: string, entityB: string
function event(body: unknown, roleId = roleA, tenantId = tenantA) { return { context: { auth: { tenantId, roleId }, body } } }
beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.APP_DATABASE_URL = testDb.appUrl
  for (const id of [tenantA, tenantB]) await admin`insert into tenants (id, name) values (${id}, 'Test')`
  const [a] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantA}, 'Admin', true) returning id`
  const [r] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantA}, 'Operador', false) returning id`
  roleA = a.id; regular = r.id
  const [ea] = await admin`insert into entities (tenant_id, slug, name) values (${tenantA}, 'recepciones', 'Recepciones') returning id`
  const [eb] = await admin`insert into entities (tenant_id, slug, name) values (${tenantB}, 'privado', 'Privado') returning id`
  entityA = ea.id; entityB = eb.id
  vi.stubGlobal('defineEventHandler', (handler: any) => handler)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('readValidatedBody', async (event: any, parse: any) => parse(event.context.body))
  save = (await import('../../server/api/navigation/index.put')).default
  load = (await import('../../server/api/navigation/index.get')).default
}, 60000)
afterAll(async () => { await admin?.end(); await testDb?.stop(); vi.unstubAllGlobals() })
describe('Configuración de navegación aislada por organización', () => {
  it('solo permite administradores del tenant autenticado', async () => {
    await expect(save(event({ revision: 0, layout: { groups: [] } }, regular))).rejects.toMatchObject({ statusCode: 403 })
    await expect(load(event({}, regular))).rejects.toMatchObject({ statusCode: 403 })
    await expect(save(event({ revision: 0, layout: { groups: [] } }, roleA, tenantB))).rejects.toMatchObject({ statusCode: 403 })
  })
  it('rechaza asignar un módulo de otra organización sin guardar parcialmente', async () => {
    const layout = { groups: [{ id: randomUUID(), name: 'Producción', icon: null, parentId: null, entityIds: [entityA, entityB] }] }
    await expect(save(event({ revision: 0, layout }))).rejects.toMatchObject({ statusCode: 400 })
    expect((await load(event({}))).revision).toBe(0)
  })
  it('guarda, persiste el orden y evita sobreescribir cambios simultáneos', async () => {
    const layout = { groups: [{ id: randomUUID(), name: 'Producción', icon: 'Factory', parentId: null, entityIds: [entityA] }] }
    expect(await save(event({ revision: 0, layout }))).toMatchObject({ revision: 1, layout })
    expect(await load(event({}))).toMatchObject({ revision: 1, layout })
    await expect(save(event({ revision: 0, layout: { groups: [] } }))).rejects.toMatchObject({ statusCode: 409 })
    const [other] = await admin`select navigation_revision from tenants where id = ${tenantB}`
    expect(other.navigation_revision).toBe(0)
  })
})
