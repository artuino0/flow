import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
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
let lineEntityId: string
let productEntityId: string
let productId: string
let automation: typeof import('../../server/utils/triggerActions')
let userId: string
let deleteRecord: (event: any) => Promise<unknown>
let patchRecord: (event: any) => Promise<unknown>

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
  await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${entityId}, 'estado', 'Estado', 'select', ${admin.json({ options: [{ value: 'borrador', label: 'Borrador' }, { value: 'pagado', label: 'Pagado' }] } as never)}), (${entityId}, 'nota', 'Nota', 'text', '{}'::jsonb), (${entityId}, 'cliente', 'Cliente', 'text', '{}'::jsonb), (${entityId}, 'referencia', 'Referencia de pago', 'text', '{}'::jsonb)`
  const [lines] = await admin`insert into entities (tenant_id, name, slug, detail_layout) values (${TENANT}, 'Partidas', 'partidas', ${admin.json({ relations: [{ entitySlug: 'partidas', fieldName: 'pedido' }] })}) returning id`
  lineEntityId = lines!.id
  const [products] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Productos', 'productos') returning id`
  productEntityId = products!.id
  await admin`update entities set detail_layout = ${admin.json({ relations: [{ entitySlug: 'partidas', fieldName: 'pedido' }] })} where id = ${entityId}`
  await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${lineEntityId}, 'pedido', 'Pedido', 'relation', ${admin.json({ relationEntity: 'pedidos' })}), (${lineEntityId}, 'cantidad', 'Cantidad', 'number', '{}'::jsonb), (${lineEntityId}, 'producto', 'Producto', 'relation', ${admin.json({ relationEntity: 'productos' })}), (${lineEntityId}, 'importe', 'Importe', 'number', '{}'::jsonb), (${productEntityId}, 'nombre', 'Nombre', 'text', '{}'::jsonb), (${productEntityId}, 'disponible', 'Disponible', 'number', '{}'::jsonb)`
  const [product] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${productEntityId}, ${admin.json({ nombre: 'Huevo', disponible: 12 })}) returning id`
  productId = product!.id
  const [person] = await admin`insert into people (email, password_hash, full_name) values ('workflow@test.local', 'x', 'Workflow Tester') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${TENANT}, ${adminRoleId}, ${person!.id}) returning id`
  userId = user!.id
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete) values (${adminRoleId}, ${entityId}, true, true, true, true)`
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete) values (${workerRoleId}, ${entityId}, true, true, true, true)`
  const [record] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${entityId}, ${admin.json({ estado: 'borrador', nota: '', cliente: 'A' } as never)}) returning id`
  recordId = record!.id
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ withTenant } = await import('../../server/db'))
  workflow = await import('../../server/utils/stateWorkflow')
  automation = await import('../../server/utils/triggerActions')
  vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<unknown>) => handler)
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event.context.params?.[name])
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('readValidatedBody', async (event: any, parse: (body: unknown) => unknown) => parse(event.context.body))
  deleteRecord = (await import('../../server/api/records/[entity]/[id].delete')).default
  patchRecord = (await import('../../server/api/records/[entity]/[id].patch')).default
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

  it('DELETE de un registro en estado bloqueado responde 409 y conserva el registro', async () => {
    await admin`update records set custom_data = ${admin.json({ estado: 'pagado', nota: '', cliente: 'A', referencia: '' })} where id = ${recordId}`
    const event = { context: { auth: { tenantId: TENANT, roleId: adminRoleId, sub: userId }, params: { entity: 'pedidos', id: recordId } } }
    await expect(deleteRecord(event)).rejects.toMatchObject({ statusCode: 409 })
    const [remaining] = await admin`select deleted_at from records where id = ${recordId}`
    expect(remaining?.deleted_at).toBeNull()
    await admin`update records set custom_data = ${admin.json({ estado: 'borrador', nota: '', cliente: 'A', referencia: '' })} where id = ${recordId}`
  })

  it('permite reabrir con el rol autorizado', async () => {
    await expect(withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId: adminRoleId, userId: null, recordId, current: { estado: 'pagado' }, next: { estado: 'borrador' }, changedFields: ['estado'] }))).resolves.toBeDefined()
  })

  async function setRules(rules: unknown[], rolesForTransition: string[] | 'all' = [adminRoleId]) {
    const nextConfig = { ...(configValue as Record<string, unknown>), transitions: [{ from: 'borrador', to: 'pagado', roles: rolesForTransition }, { from: 'pagado', to: 'borrador', roles: [adminRoleId], label: 'Reabrir' }], rules }
    await admin`update entities set workflow_config = ${admin.json(nextConfig as never)} where id = ${entityId}`
  }
  async function addLine(quantity: number, importe = quantity) {
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${lineEntityId}, ${admin.json({ pedido: recordId, cantidad: quantity, producto: productId, importe })})`
  }
  async function clearLines() {
    await admin`delete from records where entity_id = ${lineEntityId} and custom_data->>'pedido' = ${recordId}`
  }
  function evaluate(next: Record<string, unknown>, acknowledgeWarnings = false, roleId = adminRoleId) {
    return withTenant(TENANT, tx => workflow.enforceWorkflowChange(tx, { tenantId: TENANT, entityId, roleId, userId, recordId, current: { estado: 'borrador', referencia: '' }, next: { estado: 'pagado', referencia: '', ...next }, changedFields: ['estado'], acknowledgeWarnings }))
  }

  it('required bloquea valores vacíos y deja pasar valores informados; warn exige acknowledgeWarnings y audita usuario y transición', async () => {
    const block = { type: 'required', mode: 'block', when: { to: 'pagado' }, fields: ['referencia'], message: 'Referencia requerida' }
    await setRules([block])
    await expect(evaluate({ referencia: '' })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('referencia') })
    await expect(evaluate({ referencia: 'PAGO-1' })).resolves.toBeDefined()

    const warn = { ...block, mode: 'warn', message: 'Confirma que la referencia puede faltar' }
    await setRules([warn])
    await expect(evaluate({ referencia: '' })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('WARNINGS:') })
    await expect(evaluate({ referencia: '' }, true)).resolves.toBeDefined()
    const [activity] = await admin`select user_id, details from record_activities where record_id = ${recordId} and action_type = 'STATUS_CHANGED' order by created_at desc limit 1`
    expect(activity?.user_id).toBe(userId)
    expect(activity?.details).toMatchObject({ from: 'borrador', to: 'pagado', acceptedWarnings: ['Confirma que la referencia puede faltar: referencia'] })
  })

  it('lineCompare block y warn informan el faltante de 18 docenas y permiten la partida dentro de disponibilidad', async () => {
    await clearLines()
    const rule = { type: 'lineCompare', mode: 'block', when: { to: 'pagado' }, lineEntity: 'partidas', relationField: 'pedido', valueField: 'cantidad', relatedField: 'producto', compareField: 'disponible', operator: '<=', message: 'Disponibilidad excedida' }
    await setRules([rule])
    const validated = await withTenant(TENANT, tx => workflow.validateWorkflowConfig(tx, TENANT, entityId, { ...(configValue as Record<string, unknown>), rules: [rule] }))
    expect(validated?.rules).toHaveLength(1)
    await addLine(30)
    await expect(evaluate({})).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('18') })
    await clearLines()
    await addLine(12)
    await expect(evaluate({})).resolves.toBeDefined()

    await clearLines()
    await addLine(30)
    await setRules([{ ...rule, mode: 'warn' }])
    await expect(evaluate({})).rejects.toMatchObject({ message: expect.stringContaining('WARNINGS:') })
    await expect(evaluate({}, true)).resolves.toBeDefined()
  })

  it('aggregate count y sum ejecutan block/warn con partidas vacías, insuficientes y suficientes', async () => {
    await clearLines()
    const countBlock = { type: 'aggregate', mode: 'block', when: { to: 'pagado' }, lineEntity: 'partidas', relationField: 'pedido', aggregate: 'count', operator: '>', value: 0, message: 'Agrega partidas' }
    await setRules([countBlock])
    await expect(evaluate({})).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('Agrega partidas') })
    await addLine(12, 12)
    await expect(evaluate({})).resolves.toBeDefined()
    await setRules([{ ...countBlock, mode: 'warn', operator: '>', value: 1 }])
    await expect(evaluate({})).rejects.toMatchObject({ message: expect.stringContaining('WARNINGS:') })
    await expect(evaluate({}, true)).resolves.toBeDefined()
    await addLine(12, 12)
    await expect(evaluate({})).resolves.toBeDefined()

    const sumBlock = { type: 'aggregate', mode: 'block', when: { to: 'pagado' }, lineEntity: 'partidas', relationField: 'pedido', aggregate: 'sum', field: 'importe', operator: '>', value: 0, message: 'Importe debe ser positivo' }
    await setRules([sumBlock])
    await expect(evaluate({})).resolves.toBeDefined()
    await setRules([{ ...sumBlock, mode: 'warn', operator: '>', value: 1000 }])
    await expect(evaluate({})).rejects.toMatchObject({ message: expect.stringContaining('WARNINGS:') })
    await expect(evaluate({}, true)).resolves.toBeDefined()
  })

  it('una transición no autorizada para el rol del tablero se rechaza; un módulo sin reglas conserva el flujo previo', async () => {
    await setRules([])
    await expect(evaluate({}, false, workerRoleId)).rejects.toMatchObject({ statusCode: 403 })
    const event = { context: { auth: { tenantId: TENANT, roleId: workerRoleId, sub: userId }, params: { entity: 'pedidos', id: recordId }, body: { changes: { estado: 'pagado' } } } }
    await expect(patchRecord(event)).rejects.toMatchObject({ statusCode: 403 })
    await expect(evaluate({ referencia: '' })).resolves.toBeDefined()
  })

  it('automatización trata los avisos como aceptados y guarda su ejecución en trigger_logs', async () => {
    await setRules([{ type: 'required', mode: 'warn', when: { to: 'pagado' }, fields: ['referencia'], message: 'La automatización acepta referencia vacía' }], 'all')
    const [trigger] = await admin`insert into triggers (tenant_id, entity_id, name, trigger_event, condition, is_active) values (${TENANT}, ${entityId}, 'Workflow aviso', 'on_update', ${admin.json({ always: true })}, true) returning id`
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order) values (${TENANT}, ${trigger!.id}, 'update_field', ${admin.json({ field: 'estado', value: 'pagado' })}, 0)`
    await automation.executeTriggerActions(TENANT, entityId, trigger!.id, 'Workflow aviso', recordId, 'on_update', { estado: 'borrador', referencia: '' })
    const [log] = await admin`select status, last_error, request_payload from trigger_logs where trigger_id = ${trigger!.id} order by created_at desc limit 1`
    expect(log?.status).toBe('success')
    expect(log?.request_payload).toMatchObject({ acceptedWarnings: ['La automatización acepta referencia vacía: referencia'] })
    const [record] = await admin`select custom_data from records where id = ${recordId}`
    expect((record!.custom_data as Record<string, unknown>).estado).toBe('pagado')
  })
})
