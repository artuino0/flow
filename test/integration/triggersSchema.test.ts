import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

// HU-ERD-47: prueba el ESQUEMA (triggers/trigger_actions/trigger_logs) contra
// un Postgres real, mismo criterio que rlsTenantIsolation.test.ts (HU-ERD-29) -
// conectado como erp_app, no como superusuario, para que RLS aplique de
// verdad. Todavia no existe server/utils/triggers.ts (eso es ERD-48/49) - por
// eso esto opera con SQL directo, igual que la HU original de RLS.

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'

let testDb: TestDb
let app: Sql

async function asTenant<T>(tenantId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  const result = await app.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${tenantId}', true)`)
    return fn(tx)
  })
  return result as T
}

let entityAId: string
let entityBId: string

beforeAll(async () => {
  testDb = await createTestDb()
  app = postgres(testDb.appUrl, { max: 1 })

  const entityA = await asTenant(TENANT_A, (tx) =>
    tx.unsafe(`insert into entities (tenant_id, name, slug) values ('${TENANT_A}', 'Pedidos A', 'pedidos-a') returning id`)
  )
  entityAId = entityA[0].id
  const entityB = await asTenant(TENANT_B, (tx) =>
    tx.unsafe(`insert into entities (tenant_id, name, slug) values ('${TENANT_B}', 'Pedidos B', 'pedidos-b') returning id`)
  )
  entityBId = entityB[0].id
}, 30000)

afterAll(async () => {
  await app.end()
  await testDb.stop()
})

describe('esquema de triggers (Postgres real, RLS)', () => {
  it('las tres tablas tienen RLS habilitada y trigger_logs quita FORCE para la función de reintentos', async () => {
    const rows = await app.unsafe(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('triggers','trigger_actions','trigger_logs') and relkind = 'r' order by relname`
    )
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true)
      expect(row.relforcerowsecurity).toBe(row.relname !== 'trigger_logs')
    }
    const policies = await app.unsafe(`select policyname from pg_policies where tablename = 'trigger_logs' and policyname = 'tenant_isolation_trigger_logs'`)
    expect(policies).toHaveLength(1)
  })

  it('erp_app conserva el aislamiento en SELECT directo y puede ejecutar las funciones SECURITY DEFINER', async () => {
    // NO FORCE deja que el dueño de la tabla lea globalmente desde las funciones
    // SECURITY DEFINER de 0073/0075/0076; erp_app conserva RLS en consultas directas.
    const [triggerA] = await asTenant(TENANT_A, (tx) => tx.unsafe(
      `insert into triggers (tenant_id, entity_id, name, trigger_event) values ('${TENANT_A}', '${entityAId}', 'ETL A', 'on_create') returning id`
    ))
    const [triggerB] = await asTenant(TENANT_B, (tx) => tx.unsafe(
      `insert into triggers (tenant_id, entity_id, name, trigger_event) values ('${TENANT_B}', '${entityBId}', 'ETL B', 'on_create') returning id`
    ))
    await asTenant(TENANT_A, (tx) => tx.unsafe(
      `insert into trigger_logs (tenant_id, trigger_id, status, attempt_count) values ('${TENANT_A}', '${triggerA.id}', 'retrying', 0)`
    ))
    await asTenant(TENANT_B, (tx) => tx.unsafe(
      `insert into trigger_logs (tenant_id, trigger_id, status, attempt_count) values ('${TENANT_B}', '${triggerB.id}', 'retrying', 0)`
    ))
    await asTenant(TENANT_A, (tx) => tx.unsafe(
      `insert into records (entity_id, tenant_id, custom_data) values ('${entityAId}', '${TENANT_A}', '{}')`
    ))
    await asTenant(TENANT_B, (tx) => tx.unsafe(
      `insert into records (entity_id, tenant_id, custom_data) values ('${entityBId}', '${TENANT_B}', '{}')`
    ))

    const visibleAsA = await asTenant(TENANT_A, async (tx) => ({
      entities: await tx.unsafe('select tenant_id from entities'),
      records: await tx.unsafe('select tenant_id from records'),
      logs: await tx.unsafe('select tenant_id from trigger_logs')
    }))
    expect(visibleAsA.entities).toHaveLength(1)
    expect(visibleAsA.entities[0].tenant_id).toBe(TENANT_A)
    expect(visibleAsA.records).toHaveLength(1)
    expect(visibleAsA.records[0].tenant_id).toBe(TENANT_A)
    expect(visibleAsA.logs).toHaveLength(1)
    expect(visibleAsA.logs[0].tenant_id).toBe(TENANT_A)

    const retries = await app.unsafe(`select * from due_trigger_retries(now() + interval '10 days', 10)`)
    expect(retries).toHaveLength(2)
    const changed = await app.unsafe(`select * from olap_changed_records('1970-01-01T00:00:00Z'::timestamptz, '00000000-0000-0000-0000-000000000000'::uuid, now() + interval '1 minute', 10)`)
    expect(changed).toHaveLength(2)

    await asTenant(TENANT_A, async (tx) => {
      await tx.unsafe(`delete from records where tenant_id = '${TENANT_A}'`)
      await tx.unsafe(`delete from trigger_logs where trigger_id = '${triggerA.id}'`)
      await tx.unsafe(`delete from triggers where id = '${triggerA.id}'`)
    })
    await asTenant(TENANT_B, async (tx) => {
      await tx.unsafe(`delete from records where tenant_id = '${TENANT_B}'`)
      await tx.unsafe(`delete from trigger_logs where trigger_id = '${triggerB.id}'`)
      await tx.unsafe(`delete from triggers where id = '${triggerB.id}'`)
    })
  })

  it('inserta un trigger + accion + log del tenant A, invisibles para el tenant B', async () => {
    const [trigger] = await asTenant(TENANT_A, (tx) =>
      tx.unsafe(
        `insert into triggers (tenant_id, entity_id, name, trigger_event, condition)
         values ('${TENANT_A}', '${entityAId}', 'Notificar pedido nuevo', 'on_create', '{"field":"estado","operator":"eq","value":"nuevo"}')
         returning id`
      )
    )
    await asTenant(TENANT_A, (tx) =>
      tx.unsafe(
        `insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order)
         values ('${TENANT_A}', '${trigger.id}', 'webhook', '{"url":"https://example.com/hook"}', 0)`
      )
    )
    await asTenant(TENANT_A, (tx) =>
      tx.unsafe(
        `insert into trigger_logs (tenant_id, trigger_id, status, attempt_count)
         values ('${TENANT_A}', '${trigger.id}', 'success', 1)`
      )
    )

    const asA = await asTenant(TENANT_A, (tx) => tx.unsafe('select name from triggers'))
    expect(asA.map((r) => r.name)).toEqual(['Notificar pedido nuevo'])

    const asB = await asTenant(TENANT_B, (tx) => tx.unsafe('select name from triggers'))
    expect(asB).toHaveLength(0)

    const actionsAsB = await asTenant(TENANT_B, (tx) => tx.unsafe('select action_type from trigger_actions'))
    expect(actionsAsB).toHaveLength(0)

    const logsAsB = await asTenant(TENANT_B, (tx) => tx.unsafe('select status from trigger_logs'))
    expect(logsAsB).toHaveLength(0)
  })

  it('un INSERT con tenant_id de OTRO tenant (bajo el contexto de A) es rechazado por la policy, en las tres tablas', async () => {
    await expect(
      asTenant(TENANT_A, (tx) =>
        tx.unsafe(
          `insert into triggers (tenant_id, entity_id, name, trigger_event) values ('${TENANT_B}', '${entityBId}', 'Colado', 'on_create')`
        )
      )
    ).rejects.toThrow()
  })

  it('entity_id debe pertenecer a una entidad real (FK) - un uuid inventado falla', async () => {
    await expect(
      asTenant(TENANT_A, (tx) =>
        tx.unsafe(
          `insert into triggers (tenant_id, entity_id, name, trigger_event) values ('${TENANT_A}', '00000000-0000-0000-0000-000000000000', 'x', 'on_create')`
        )
      )
    ).rejects.toThrow()
  })

  it('borrar la entidad borra en cascada sus triggers (y trigger_actions con ellos)', async () => {
    const [entity] = await asTenant(TENANT_A, (tx) =>
      tx.unsafe(`insert into entities (tenant_id, name, slug) values ('${TENANT_A}', 'Temporal', 'temporal-cascade') returning id`)
    )
    const [trigger] = await asTenant(TENANT_A, (tx) =>
      tx.unsafe(
        `insert into triggers (tenant_id, entity_id, name, trigger_event) values ('${TENANT_A}', '${entity.id}', 'Se borra', 'on_delete') returning id`
      )
    )
    await asTenant(TENANT_A, (tx) =>
      tx.unsafe(`insert into trigger_actions (tenant_id, trigger_id, action_type, config) values ('${TENANT_A}', '${trigger.id}', 'email', '{}')`)
    )

    await asTenant(TENANT_A, (tx) => tx.unsafe(`delete from entities where id = '${entity.id}'`))

    const remainingTriggers = await asTenant(TENANT_A, (tx) => tx.unsafe(`select id from triggers where id = '${trigger.id}'`))
    expect(remainingTriggers).toHaveLength(0)
    const remainingActions = await asTenant(TENANT_A, (tx) => tx.unsafe(`select id from trigger_actions where trigger_id = '${trigger.id}'`))
    expect(remainingActions).toHaveLength(0)
  })

  it('borrar el record de un trigger_log deja record_id en null (no borra el log de auditoría)', async () => {
    const [trigger] = await asTenant(TENANT_A, (tx) =>
      tx.unsafe(
        `insert into triggers (tenant_id, entity_id, name, trigger_event) values ('${TENANT_A}', '${entityAId}', 'Audita', 'on_update') returning id`
      )
    )
    const [record] = await asTenant(TENANT_A, (tx) =>
      tx.unsafe(`insert into records (entity_id, tenant_id, custom_data) values ('${entityAId}', '${TENANT_A}', '{}') returning id`)
    )
    const [log] = await asTenant(TENANT_A, (tx) =>
      tx.unsafe(
        `insert into trigger_logs (tenant_id, trigger_id, record_id, status) values ('${TENANT_A}', '${trigger.id}', '${record.id}', 'success') returning id`
      )
    )

    await asTenant(TENANT_A, (tx) => tx.unsafe(`delete from records where id = '${record.id}'`))

    const [row] = await asTenant(TENANT_A, (tx) => tx.unsafe(`select record_id from trigger_logs where id = '${log.id}'`))
    expect(row.record_id).toBeNull()
  })

  it('existe el índice compuesto (status, created_at) sobre trigger_logs, para el barrido de reintentos', async () => {
    const rows = await app.unsafe(`select indexname from pg_indexes where tablename = 'trigger_logs' and indexname = 'trigger_logs_status_created_idx'`)
    expect(rows).toHaveLength(1)
  })
})
