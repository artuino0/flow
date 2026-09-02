import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { evaluateTriggersForRecord as EvaluateTriggersForRecord } from '../../server/utils/triggers'

// HU-ERD-48: prueba evaluateTriggersForRecord() contra un Postgres real (mismo
// criterio que triggersSchema.test.ts, HU-ERD-47, y users.test.ts, HU-ERD-84 -
// import dinamico DESPUES de fijar APP_DATABASE_URL, porque server/db/index.ts
// lee la connection string al cargar el modulo). Cubre exactamente los tres
// casos de la aceptacion de ERD-48: condiciones true/false, combinacion
// AND/OR, y referencia a un campo inexistente (trigger invalido -> trigger_logs).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let evaluateTriggersForRecord: typeof EvaluateTriggersForRecord

let entityId: string

async function insertTrigger(name: string, event: string, condition: unknown): Promise<string> {
  const [row] = await admin`
    insert into triggers (tenant_id, entity_id, name, trigger_event, condition)
    values (${TENANT_A}, ${entityId}, ${name}, ${event}, ${JSON.stringify(condition)})
    returning id
  `
  return row.id as string
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Acme Corp')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Otro Tenant')`

  const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Pedidos', 'pedidos') returning id`
  entityId = entity.id as string

  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'estado', 'Estado', 'text')`
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'monto', 'Monto', 'number')`

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ evaluateTriggersForRecord } = await import('../../server/utils/triggers'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('evaluateTriggersForRecord (Postgres real)', () => {
  it('una condicion que evalua a true queda en matched', async () => {
    const triggerId = await insertTrigger('Pedido nuevo', 'on_create', { field: 'estado', operator: 'eq', value: 'nuevo' })

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_create', { estado: 'nuevo', monto: 100 })

    expect(result.matched.map((m) => m.id)).toContain(triggerId)
    expect(result.invalid).toHaveLength(0)
  })

  it('una condicion que evalua a false NO queda en matched (y tampoco en invalid - es valida, simplemente no aplica)', async () => {
    const triggerId = await insertTrigger('Pedido cerrado', 'on_create', { field: 'estado', operator: 'eq', value: 'cerrado' })

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_create', { estado: 'nuevo', monto: 100 })

    expect(result.matched.map((m) => m.id)).not.toContain(triggerId)
    expect(result.invalid.map((i) => i.id)).not.toContain(triggerId)
  })

  it('combinacion AND: solo matchea si TODAS las hojas son true', async () => {
    const triggerId = await insertTrigger('Pedido grande nuevo', 'on_update', {
      and: [
        { field: 'estado', operator: 'eq', value: 'nuevo' },
        { field: 'monto', operator: 'gt', value: 1000 }
      ]
    })

    const casoTrue = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_update', { estado: 'nuevo', monto: 1500 })
    expect(casoTrue.matched.map((m) => m.id)).toContain(triggerId)

    const casoFalse = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_update', { estado: 'nuevo', monto: 500 })
    expect(casoFalse.matched.map((m) => m.id)).not.toContain(triggerId)
  })

  it('combinacion OR: matchea con que UNA hoja sea true', async () => {
    const triggerId = await insertTrigger('Pedido urgente o grande', 'on_update', {
      or: [
        { field: 'estado', operator: 'eq', value: 'urgente' },
        { field: 'monto', operator: 'gt', value: 10000 }
      ]
    })

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_update', { estado: 'urgente', monto: 1 })
    expect(result.matched.map((m) => m.id)).toContain(triggerId)
  })

  it('un trigger cuya condicion referencia un campo que no existe en entity_fields queda invalido, con fila en trigger_logs', async () => {
    const triggerId = await insertTrigger('Campo fantasma', 'on_create', { field: 'campo_que_no_existe', operator: 'eq', value: 'x' })

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_create', { estado: 'nuevo' })

    expect(result.matched.map((m) => m.id)).not.toContain(triggerId)
    const invalidEntry = result.invalid.find((i) => i.id === triggerId)
    expect(invalidEntry).toBeDefined()
    expect(invalidEntry?.reason).toContain('campo_que_no_existe')

    const logs = await admin`select status, last_error from trigger_logs where trigger_id = ${triggerId}`
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('failed')
    expect(logs[0].last_error).toContain('campo_que_no_existe')
  })

  it('un trigger con condition sin forma valida (default {} sin configurar) queda invalido, nunca "siempre true"', async () => {
    const [row] = await admin`
      insert into triggers (tenant_id, entity_id, name, trigger_event) values (${TENANT_A}, ${entityId}, 'Sin configurar', 'on_create') returning id
    `
    const triggerId = row.id as string

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_create', { estado: 'nuevo' })

    expect(result.matched.map((m) => m.id)).not.toContain(triggerId)
    expect(result.invalid.map((i) => i.id)).toContain(triggerId)
  })

  it('un trigger inactivo (is_active=false) nunca se evalua ni matchea ni invalida', async () => {
    const [row] = await admin`
      insert into triggers (tenant_id, entity_id, name, trigger_event, condition, is_active)
      values (${TENANT_A}, ${entityId}, 'Apagado', 'on_create', ${JSON.stringify({ field: 'estado', operator: 'eq', value: 'nuevo' })}, false)
      returning id
    `
    const triggerId = row.id as string

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_create', { estado: 'nuevo' })

    expect(result.matched.map((m) => m.id)).not.toContain(triggerId)
    expect(result.invalid.map((i) => i.id)).not.toContain(triggerId)
  })

  it('un trigger de OTRO evento (on_delete) no se evalua cuando el evento es on_create', async () => {
    const triggerId = await insertTrigger('Al borrar', 'on_delete', { field: 'estado', operator: 'eq', value: 'nuevo' })

    const result = await evaluateTriggersForRecord(TENANT_A, entityId, 'on_create', { estado: 'nuevo' })

    expect(result.matched.map((m) => m.id)).not.toContain(triggerId)
  })

  it('respeta el aislamiento por tenant: un trigger del tenant A no se evalua bajo el tenant B', async () => {
    await insertTrigger('Solo de A', 'on_create', { field: 'estado', operator: 'eq', value: 'nuevo' })

    const [entityB] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_B}, 'Pedidos B', 'pedidos-b') returning id`
    const result = await evaluateTriggersForRecord(TENANT_B, entityB.id as string, 'on_create', { estado: 'nuevo' })

    expect(result.matched).toHaveLength(0)
    expect(result.invalid).toHaveLength(0)
  })
})
