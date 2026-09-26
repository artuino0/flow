import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { getPlanUsage as GetPlanUsage } from '../../server/utils/billing'
import type { saveTenantOverride as SaveTenantOverride } from '../../server/utils/plans'

const tenantId = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let getPlanUsage: typeof GetPlanUsage
let saveTenantOverride: typeof SaveTenantOverride

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id,name) values (${tenantId},'ERD100 usage')`
  await admin`insert into entities (tenant_id,name,slug,module_kind) values (${tenantId},'Módulo','modulo','hecho'),(${tenantId},'Catálogo','catalogo','dimension')`
  process.env.PLAN_CACHE_TTL_MS = '50'
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ getPlanUsage } = await import('../../server/utils/billing'))
  ;({ saveTenantOverride } = await import('../../server/utils/plans'))
}, 60_000)

afterAll(async () => {
  if (admin) await admin.end()
  if (testDb) await testDb.stop()
  delete process.env.APP_DATABASE_URL
  delete process.env.PLAN_CACHE_TTL_MS
})

describe('getPlanUsage', () => {
  it('asigna Starter por omisión y excluye los catálogos del conteo de módulos', async () => {
    const result = await getPlanUsage(tenantId)
    expect(result).toMatchObject({ plan: 'Starter', code: 'starter' })
    expect(result.usage.find(item => item.concept === 'modules')).toMatchObject({ used: 1, limit: 10 })
    expect(result.usage.find(item => item.concept === 'emails')).toMatchObject({ used: 0, limit: 2000 })
  })

  it('lee límites editados desde la base sin reiniciar y aplica el override vigente', async () => {
    await admin`update plan_limits set value = 4321 where concept = 'emails' and plan_id = (select id from plans where key = 'starter')`
    await new Promise(resolve => setTimeout(resolve, 80))
    let usage = await getPlanUsage(tenantId)
    expect(usage.usage.find(item => item.concept === 'emails')?.limit).toBe(4321)
    await saveTenantOverride({ tenantId, concept: 'emails', value: 17, reason: 'Contrato especial de prueba', validFrom: null, validUntil: null })
    usage = await getPlanUsage(tenantId)
    expect(usage.usage.find(item => item.concept === 'emails')?.limit).toBe(17)
  })
})
