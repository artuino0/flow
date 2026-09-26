import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

const TENANT = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let withTenant: typeof import('../../server/db').withTenant
let workflow: typeof import('../../server/utils/stateWorkflow')
let entityId: string
let recordId: string
let adminRoleId: string
let workerRoleId: string
let configValue: unknown

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT}, 'Flujos')`
  const [adminRole] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT}, 'Administrador', true) returning id`
  const [workerRole] = await admin`insert into roles (tenant_id, name) values (${TENANT}, 'Operador') returning id`
  adminRoleId = adminRole!.id
  workerRoleId = workerRole!.id
  const states = { borrador: { locked: false, editableFields: [] }, pagado: { locked: true, editableFields: ['nota'] } }
  configValue = { enabled: true, field: 'estado', initial: 'borrador', states, transitions: [{ from: 'borrador', to: 'pagado', roles: [adminRoleId] }, { from: 'pagado', to: 'borrador', roles: [adminRoleId], label: 'Reabrir' }], rules: [] }
  const [entity] = await admin`insert into entities (tenant_id, name, slug, workflow_config) values (${TENANT}, 'Pedidos', 'pedidos', ${admin.json(configValue as never)}) returning id`
  entityId = entity!.id
  await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${entityId}, 'estado', 'Estado', 'select', ${admin.json({ options: [{ value: 'borrador', label: 'Borrador' }, { value: 'pagado', label: 'Pagado' }] } as never)}), (${entityId}, 'nota', 'Nota', 'text', '{}'::jsonb), (${entityId}, 'cliente', 'Cliente', 'text', '{}'::jsonb)`
  const [record] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${entityId}, ${admin.json({ estado: 'borrador', nota: '', cliente: 'A' } as never)}) returning id`
  recordId = record!.id
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ withTenant } = await import('../../server/db'))
  workflow = await import('../../server/utils/stateWorkflow')
}, 60_000)

afterAll(async () => { await admin.end(); await testDb.stop() })

describe('stateWorkflow (Postgres real)', () => {
  it('valida el Select, opciones y roles configurados', async () => {
    const config = await withTenant(TENANT, tx => workflow.validateWorkflowConfig(tx, TENANT, entityId, configValue))
    expect(config?.enabled).toBe(true)
  })

  it('autoriza transición, bloquea rol no autorizado y registra la actividad de estado', async () => {
    await expect(withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId: workerRoleId, userId: null, recordId, current: { estado: 'borrador' }, next: { estado: 'pagado' }, changedFields: ['estado'] }))).rejects.toMatchObject({ statusCode: 403 })
    await withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId: adminRoleId, userId: null, recordId, current: { estado: 'borrador' }, next: { estado: 'pagado' }, changedFields: ['estado'] }))
    const rows = await admin`select details from record_activities where record_id = ${recordId} and action_type = 'STATUS_CHANGED'`
    expect(rows[0]?.details).toMatchObject({ from: 'borrador', to: 'pagado' })
  })

  it('permite el campo exceptuado en estado bloqueado y rechaza los demás', async () => {
    await expect(withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId: adminRoleId, userId: null, recordId, current: { estado: 'pagado' }, next: { estado: 'pagado', nota: 'ajuste' }, changedFields: ['nota'] }))).resolves.toBeNull()
    await expect(withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId: adminRoleId, userId: null, recordId, current: { estado: 'pagado' }, next: { estado: 'pagado', cliente: 'B' }, changedFields: ['cliente'] }))).rejects.toMatchObject({ statusCode: 409 })
    await expect(withTenant(TENANT, tx => workflow.assertWorkflowNotLocked(tx, TENANT, entityId, { estado: 'pagado' }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('permite reabrir con el rol autorizado', async () => {
    await expect(withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId: adminRoleId, userId: null, recordId, current: { estado: 'pagado' }, next: { estado: 'borrador' }, changedFields: ['estado'] }))).resolves.toBeDefined()
  })
})
