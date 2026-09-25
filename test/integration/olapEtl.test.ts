import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { runOlapEtl as RunOlapEtl } from '../../server/utils/olapEtl'

let testDb: TestDb
let admin: postgres.Sql
let runOlapEtl: typeof RunOlapEtl
const fixedNow = new Date('2030-01-01T00:00:00.000Z')
let tenants: string[]
let entities: Record<string, string>

async function setupTenant(slug: string, withClient = false) {
  const tenantId = randomUUID()
  await admin`insert into tenants (id, name) values (${tenantId}, ${slug})`
  const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${tenantId}, ${slug}, ${withClient ? 'clientes' : slug}) returning id`
  tenants.push(tenantId)
  entities[tenantId] = entity.id as string
  return tenantId
}

async function insertRecord(tenantId: string, at: string, data: Record<string, unknown> = {}, deleted = false) {
  const [row] = await admin`
    insert into records (entity_id, tenant_id, custom_data, created_at, updated_at, deleted_at)
    values (${entities[tenantId]}, ${tenantId}, ${admin.json(data as never)}, ${at}, ${at}, ${deleted ? at : null})
    returning id
  `
  return row.id as string
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ runOlapEtl } = await import('../../server/utils/olapEtl'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

beforeEach(async () => {
  tenants = []
  entities = {}
  await admin`delete from fact_eventos`
  await admin`delete from dim_cliente`
  await admin`delete from dim_sucursal`
  await admin`delete from dim_date`
  await admin`delete from records`
  await admin`delete from entities`
  await admin`delete from tenants`
  await admin`delete from olap_etl_state where job = 'olap-etl'`
})

describe('runOlapEtl (ERD-87)', () => {
  it('procesa dos organizaciones y conserva los valores OLAP anteriores', async () => {
    const clientTenant = await setupTenant('clientes', true)
    const otherTenant = await setupTenant('pedidos')
    const clienteId = await insertRecord(clientTenant, '2026-05-03T12:34:56.000Z', { nombre: 'Ana', email: 'ana@example.com' })
    const otherId = await insertRecord(otherTenant, '2026-05-04T08:00:00.000Z', {})

    const result = await runOlapEtl(fixedNow, { lagMs: 0 })
    const facts = await admin`select tenant_id, record_id, date_id, cliente_id, tipo_evento, monto, cantidad from fact_eventos order by record_id`
    const cliente = await admin`select tenant_id, record_id, nombre, email from dim_cliente where record_id = ${clienteId}`

    expect(result.recordsProcessed).toBe(2)
    expect(result.tenants).toBe(2)
    expect(facts).toHaveLength(2)
    expect(facts.find((row) => row.record_id === clienteId)).toMatchObject({ tenant_id: clientTenant, record_id: clienteId, date_id: 20260503, cliente_id: expect.any(String), tipo_evento: 'clientes', monto: '0.00', cantidad: 1 })
    expect(facts.find((row) => row.record_id === otherId)).toMatchObject({ tenant_id: otherTenant, record_id: otherId, date_id: 20260504, cliente_id: null, tipo_evento: 'pedidos', monto: '0.00', cantidad: 1 })
    expect(cliente[0]).toMatchObject({ tenant_id: clientTenant, record_id: clienteId, nombre: 'Ana', email: 'ana@example.com' })
  })

  it('no reprocesa sin cambios y vuelve a procesar solo un registro actualizado', async () => {
    const tenant = await setupTenant('pedidos')
    const first = await insertRecord(tenant, '2026-05-01T00:00:00.000Z')
    const second = await insertRecord(tenant, '2026-05-02T00:00:00.000Z')
    expect((await runOlapEtl(fixedNow, { lagMs: 0 })).recordsProcessed).toBe(2)
    expect((await runOlapEtl(fixedNow, { lagMs: 0 })).recordsProcessed).toBe(0)
    await admin`update records set updated_at = '2026-05-03T00:00:00.000Z' where id = ${first}`
    const next = await runOlapEtl(fixedNow, { lagMs: 0 })
    expect(next.recordsProcessed).toBe(1)
    const rows = await admin`select record_id from fact_eventos where record_id in (${first}, ${second})`
    expect(rows).toHaveLength(2)
  })

  it('conserva microsegundos del cursor y termina cuando no hay cambios', async () => {
    const tenant = await setupTenant('microsegundos')
    for (const timestamp of ['2026-09-01 12:00:00.123456+00:00', '2026-09-01 12:00:00.234567+00:00']) {
      await admin.unsafe(`insert into records (entity_id, tenant_id, custom_data, created_at, updated_at) values ('${entities[tenant]}', '${tenant}', '{}'::jsonb, '${timestamp}'::timestamptz, '${timestamp}'::timestamptz)`)
    }

    const firstRun = await runOlapEtl(fixedNow, { budgetMs: 0, lagMs: 0 })
    const recordTimestamps = await admin`select updated_at::text as value from records where tenant_id = ${tenant} order by updated_at`
    expect(recordTimestamps.map((row) => row.value).some((value) => value.includes('.234567'))).toBe(true)
    expect(firstRun.recordsProcessed).toBe(2)
    const secondRun = await runOlapEtl(fixedNow, { budgetMs: 0, lagMs: 0 })
    expect(secondRun.recordsProcessed).toBe(0)
    expect(secondRun.reachedEnd).toBe(true)
  })

  it('recorre varios lotes y persiste el cursor al final', async () => {
    const tenant = await setupTenant('pedidos')
    for (let i = 1; i <= 5; i++) await insertRecord(tenant, `2026-06-0${i}T00:00:00.000Z`)
    const result = await runOlapEtl(fixedNow, { batchSize: 2, lagMs: 0 })
    expect(result.batches).toBe(3)
    expect(result.recordsProcessed).toBe(5)
    expect(result.reachedEnd).toBe(true)
    const [cursor] = await admin`select last_record_id from olap_etl_state where job = 'olap-etl'`
    expect(cursor.last_record_id).toBe(result.cursor.recordId)
  })

  it('respeta el presupuesto, continúa en la siguiente corrida y pasa los borrados', async () => {
    const tenant = await setupTenant('pedidos')
    for (let i = 1; i <= 5; i++) await insertRecord(tenant, `2026-07-0${i}T00:00:00.000Z`)
    const firstRun = await runOlapEtl(fixedNow, { batchSize: 2, budgetMs: 0, lagMs: 0 })
    expect(firstRun.batches).toBe(1)
    expect(firstRun.recordsProcessed).toBe(2)
    expect(firstRun.reachedEnd).toBe(false)
    const nextRun = await runOlapEtl(fixedNow, { batchSize: 2, lagMs: 0 })
    expect(nextRun.recordsProcessed).toBe(3)
    expect(nextRun.reachedEnd).toBe(true)

    const deletedTenant = await setupTenant('borrados')
    const deleted = await insertRecord(deletedTenant, '2026-08-01T00:00:00.000Z', {}, true)
    const deletedRun = await runOlapEtl(fixedNow, { lagMs: 0 })
    expect(deletedRun.recordsProcessed).toBe(0)
    expect(deletedRun.recordsSkippedDeleted).toBe(1)
    const [fact] = await admin`select id from fact_eventos where record_id = ${deleted}`
    expect(fact).toBeUndefined()
    expect(deletedRun.cursor.recordId).toBe(deleted)
  })

  it('aplaza registros dentro del lag configurado', async () => {
    const tenant = await setupTenant('pedidos')
    await insertRecord(tenant, '2029-12-31T23:59:30.000Z')
    const result = await runOlapEtl(fixedNow, { lagMs: 60_000 })
    expect(result.recordsProcessed).toBe(0)
    expect(result.reachedEnd).toBe(true)
  })
})
