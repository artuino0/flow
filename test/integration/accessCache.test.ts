import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

// Cachés de vida corta (sesión, permisos, metadatos) contra Postgres real: que se usen,
// que las escrituras los invaliden al instante y que todo se vea al vencer el tiempo.
// Aquí SÍ se encienden (en el resto de las pruebas están apagados, ver vitest.config.ts).
process.env.SESSION_CACHE_TTL_MS = '600'
process.env.ACCESS_CACHE_TTL_MS = '600'
process.env.METADATA_CACHE_TTL_MS = '600'
// rbac.ts usa createError de Nitro (auto-import): en pruebas se sustituye por una versión mínima.
;(globalThis as Record<string, unknown>).createError = (input: { statusCode: number; statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const TENANT = randomUUID()
const OTHER_TENANT = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let rbac: typeof import('../../server/utils/rbac')
let sessions: typeof import('../../server/utils/sessions')
let cache: typeof import('../../server/utils/shortCache')
let modules: typeof import('../../server/utils/moduleEntities')
let rolePerms: typeof import('../../server/utils/rolePermissions')

let roleId: string
let entityId: string
let userId: string
let sessionId: string
let counter = 0

const eventFor = (roleIdValue: string, tenantId = TENANT) => ({ context: { auth: { sub: userId, tenantId, roleId: roleIdValue } } }) as never
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function statusOf(promise: Promise<unknown>) {
  try { await promise; return 200 } catch (error) { return (error as { statusCode?: number }).statusCode ?? 500 }
}
async function setPerm(read: boolean, update = false) {
  await admin`update role_entity_permissions set can_read = ${read}, can_update = ${update} where role_id = ${roleId} and entity_id = ${entityId}`
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name, slug) values (${TENANT}, 'A', 'cache-a'), (${OTHER_TENANT}, 'B', 'cache-b')`
  ;[{ id: roleId }] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT}, 'Rol', false) returning id` as unknown as [{ id: string }]
  ;[{ id: entityId }] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Clientes', 'clientes') returning id` as unknown as [{ id: string }]
  const [person] = await admin`insert into people (email, password_hash) values ('cache@test.local', 'x') returning id`
  ;[{ id: userId }] = await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${TENANT}, ${person!.id}, ${roleId}, true) returning id` as unknown as [{ id: string }]
  process.env.APP_DATABASE_URL = testDb.appUrl
  cache = await import('../../server/utils/shortCache')
  rbac = await import('../../server/utils/rbac')
  sessions = await import('../../server/utils/sessions')
  modules = await import('../../server/utils/moduleEntities')
  rolePerms = await import('../../server/utils/rolePermissions')
}, 60_000)

afterAll(async () => { await admin.end(); await testDb.stop() })

beforeEach(async () => {
  cache.accessCache.clear(); cache.metadataCache.clear(); cache.sessionCache.clear()
  await admin`delete from role_entity_permissions where role_id = ${roleId}`
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete) values (${roleId}, ${entityId}, true, false, false, false)`
  await admin`update entities set is_active = true, deleted_at = null where id = ${entityId}`
  await admin`delete from auth_sessions`
  ;[{ id: sessionId }] = await admin`insert into auth_sessions (tenant_id, user_id, expires_at) values (${TENANT}, ${userId}, now() + interval '7 days') returning id` as unknown as [{ id: string }]
  counter++
})

describe('caché de sesión', () => {
  const owner = () => ({ sub: userId, tenantId: TENANT, sid: sessionId })

  it('una sesión validada no vuelve a consultarse; revocarla la invalida al instante', async () => {
    await sessions.validateSession(owner())
    await admin`update auth_sessions set revoked_at = now() where id = ${sessionId}` // revocada por fuera (otra instancia)
    await expect(sessions.validateSession(owner())).resolves.toBeUndefined() // aún en memoria (vida corta)
    await sessions.revokeSession(owner()) // en esta instancia sí es inmediato
    expect(await statusOf(sessions.validateSession(owner()))).toBe(401) // ya no se sirve de memoria
  })

  it('vencido el tiempo, la revocación hecha por fuera se nota', async () => {
    await sessions.validateSession(owner())
    await admin`update auth_sessions set revoked_at = now() where id = ${sessionId}`
    await sleep(700)
    await expect(sessions.validateSession(owner())).rejects.toBeDefined()
  })

  it('una sesión inválida nunca se guarda y "tocar" siempre va a la base', async () => {
    await admin`update auth_sessions set revoked_at = now() where id = ${sessionId}`
    await expect(sessions.validateSession(owner())).rejects.toBeDefined()
    expect(cache.sessionCache.size).toBe(0)
    await admin`update auth_sessions set revoked_at = null where id = ${sessionId}`
    await sessions.validateSession(owner()) // válida y guardada
    await admin`update auth_sessions set revoked_at = now() where id = ${sessionId}`
    await expect(sessions.validateSession(owner(), true)).rejects.toBeDefined() // touch=true no usa el caché
  })
})

describe('caché de permisos', () => {
  it('se sirve de memoria hasta que una escritura de permisos la invalida', async () => {
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(200)
    await setPerm(false) // cambio por fuera (otra instancia): sigue visible hasta vencer
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(200)
    // Una escritura hecha por esta instancia sí invalida al instante.
    await rolePerms.setRolePermissions(TENANT, roleId, [{ entityId, canRead: false, canCreate: false, canUpdate: false, canDelete: false }])
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(403)
  })

  it('vencido el tiempo se ve el cambio hecho por fuera', async () => {
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(200)
    await setPerm(false)
    await sleep(700)
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(403)
  })

  it('apagar un módulo desde la aplicación lo bloquea al instante para escribir y sigue permitiendo leer', async () => {
    await setPerm(true, true)
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canUpdate'))).toBe(200)
    await modules.deleteEntity(TENANT, entityId)
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canUpdate'))).toBe(403)
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(200)
    await modules.restoreEntity(TENANT, entityId)
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canUpdate'))).toBe(200)
  })

  it('requirePermissionForEntityId y getPermissionFlags comparten el mismo caché y se invalidan juntos', async () => {
    await setPerm(true, true)
    expect(await statusOf(rbac.requirePermissionForEntityId(eventFor(roleId), entityId, 'canUpdate'))).toBe(200)
    expect(await rbac.getPermissionFlags({ sub: userId, tenantId: TENANT, roleId }, entityId)).toMatchObject({ canRead: true, canUpdate: true, canCreate: false })
    await rolePerms.setRolePermissions(TENANT, roleId, [{ entityId, canRead: true, canCreate: true, canUpdate: false, canDelete: false }])
    expect(await statusOf(rbac.requirePermissionForEntityId(eventFor(roleId), entityId, 'canUpdate'))).toBe(403)
    expect(await rbac.getPermissionFlags({ sub: userId, tenantId: TENANT, roleId }, entityId)).toMatchObject({ canCreate: true, canUpdate: false })
  })

  it('el caché es por rol y por organización: un rol nunca ve los permisos de otro', async () => {
    const [other] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT}, ${'Otro ' + counter}, false) returning id`
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead'))).toBe(200)
    expect(await statusOf(rbac.requirePermission(eventFor(other!.id as string), 'clientes', 'canRead'))).toBe(403) // sin permisos
    expect(await statusOf(rbac.requirePermission(eventFor(roleId, OTHER_TENANT), 'clientes', 'canRead'))).toBe(404) // la otra organización no tiene ese módulo
  })

  it('cambiar visibilidad invalida el caché de permisos y metadatos', async () => {
    await rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead')
    expect(cache.accessCache.size).toBeGreaterThan(0)
    cache.metadataCache.set(`${TENANT}:${roleId}:fields:clientes`, { stale: true })
    await rolePerms.setRolePermissions(TENANT, roleId, [{ entityId, canRead: true, canCreate: false, canUpdate: false, canDelete: false, visibility: 'own' }])
    expect(cache.accessCache.size).toBe(0)
    expect(cache.metadataCache.get(`${TENANT}:${roleId}:fields:clientes`)).toBeUndefined()
    expect((await rolePerms.getRolePermissions(TENANT, roleId))!.permissions.find(item => item.entityId === entityId)?.visibility).toBe('own')
  })

  it('devuelve copias: modificar la respuesta no contamina el caché', async () => {
    const first = await rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead')
    first.entity.name = 'MODIFICADO'
    const second = await rbac.requirePermission(eventFor(roleId), 'clientes', 'canRead')
    expect(second.entity.name).toBe('Clientes')
  })

  it('las claves de API siguen limitadas por su alcance aunque el permiso del rol esté en caché', async () => {
    await setPerm(true, true)
    const event = { context: { auth: { sub: userId, tenantId: TENANT, roleId }, apiKeyScopes: { clientes: { read: true } } } } as never
    expect(await statusOf(rbac.requirePermission(event, 'clientes', 'canRead'))).toBe(200)
    expect(await statusOf(rbac.requirePermission(event, 'clientes', 'canUpdate'))).toBe(403)
    expect(await statusOf(rbac.requirePermission(eventFor(roleId), 'clientes', 'canUpdate'))).toBe(200)
  })
})

describe('caché de metadatos', () => {
  it('cualquier cambio de módulo o de permisos limpia los metadatos de esa organización, no los de otra', async () => {
    cache.metadataCache.set(`${TENANT}:${roleId}:fields:clientes`, { hola: 1 })
    cache.metadataCache.set(`${OTHER_TENANT}:${roleId}:fields:clientes`, { hola: 2 })
    await modules.updateEntity(TENANT, entityId, { description: 'nueva' } as never)
    expect(cache.metadataCache.get(`${TENANT}:${roleId}:fields:clientes`)).toBeUndefined()
    expect(cache.metadataCache.get(`${OTHER_TENANT}:${roleId}:fields:clientes`)).toEqual({ hola: 2 })
  })
})
