import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

// HU-ERD-104c: restaurar un módulo de la papelera vuelve a consumir cuota de
// 'modules' - restore.post.ts debe bloquear con 402 'plan_limit' al tope,
// dejar pasar a los catálogos (dimension) y conservar el 404 de siempre.
const state = vi.hoisted(() => ({ tenantId: '' }))
vi.mock('../../server/utils/rbac', () => ({ requireAdminRole: async () => ({ tenantId: state.tenantId }) }))

let testDb: TestDb
let admin: postgres.Sql
let getPlanUsage: typeof import('../../server/utils/billing').getPlanUsage
let invalidatePlanCache: typeof import('../../server/utils/plans').invalidatePlanCache
let restore: (event: any) => Promise<any>

function event(entityId: string) {
  return { context: { params: { id: entityId } } }
}

beforeAll(async () => {
  vi.stubGlobal('createError', (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'Error')), options))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRouterParam', (evt: any, name: string) => evt?.context?.params?.[name])
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.PLAN_CACHE_TTL_MS = '0'
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ getPlanUsage } = await import('../../server/utils/billing'))
  ;({ invalidatePlanCache } = await import('../../server/utils/plans'))
  restore = (await import('../../server/api/entities/[id]/restore.post')).default
}, 120_000)

afterAll(async () => {
  if (admin) await admin.end()
  if (testDb) await testDb.stop()
  delete process.env.APP_DATABASE_URL
  delete process.env.PLAN_CACHE_TTL_MS
  vi.unstubAllGlobals()
})

async function newTenant(name: string) {
  const tenantId = randomUUID()
  await admin`insert into tenants (id, name) values (${tenantId}, ${name})`
  await getPlanUsage(tenantId) // Asigna el plan Starter, como una organización nueva.
  state.tenantId = tenantId
  return tenantId
}

async function setLimit(concept: string, value: number | null) {
  await admin`insert into plan_limits (plan_id, concept, value)
    select id, ${concept}, ${value} from plans where key = 'starter'
    on conflict (plan_id, concept) do update set value = excluded.value`
  invalidatePlanCache()
}

async function addEntity(kind: 'hecho' | 'dimension', deleted: boolean) {
  const suffix = randomUUID().slice(0, 8)
  const [row] = await admin`insert into entities (tenant_id, name, slug, module_kind, is_active, deleted_at)
    values (${state.tenantId}, ${'Entidad ' + suffix}, ${'ent-' + suffix}, ${kind}, ${!deleted}, ${deleted ? new Date() : null})
    returning id`
  return row!.id as string
}

describe('POST /api/entities/[id]/restore con límite de plan', () => {
  it('restaura un módulo de hechos con cupo disponible', async () => {
    await setLimit('modules', 1)
    await newTenant('ERD104c restore ok')
    const id = await addEntity('hecho', true)
    await expect(restore(event(id))).resolves.toMatchObject({ id, isActive: true, deletedAt: null, moduleKind: 'hecho' })
  })

  it('bloquea con 402 plan_limit al restaurar con el tope de módulos alcanzado', async () => {
    await setLimit('modules', 1)
    await newTenant('ERD104c restore bloqueado')
    await addEntity('hecho', false) // ocupa el único cupo del plan
    const deletedId = await addEntity('hecho', true)
    await expect(restore(event(deletedId))).rejects.toMatchObject({
      statusCode: 402,
      data: { code: 'plan_limit', concept: 'modules' }
    })
    const [row] = await admin`select deleted_at, is_active from entities where id = ${deletedId}`
    expect(row!.deleted_at).not.toBeNull()
    expect(row!.is_active).toBe(false)
  })

  it('los catálogos (dimension) no consumen cuota y se restauran aun al tope', async () => {
    await setLimit('modules', 0)
    await newTenant('ERD104c restore dimension')
    const id = await addEntity('dimension', true)
    await expect(restore(event(id))).resolves.toMatchObject({ id, isActive: true, deletedAt: null, moduleKind: 'dimension' })
  })

  it('restaurar un módulo no borrado sigue devolviendo 404 (comportamiento anterior)', async () => {
    await setLimit('modules', 10)
    await newTenant('ERD104c restore 404')
    const id = await addEntity('hecho', false)
    await expect(restore(event(id))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('restaurar un id inexistente sigue devolviendo 404 (comportamiento anterior)', async () => {
    await setLimit('modules', 0)
    await newTenant('ERD104c restore inexistente')
    await expect(restore(event(randomUUID()))).rejects.toMatchObject({ statusCode: 404 })
  })
})
