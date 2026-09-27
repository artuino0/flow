import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { createTestDb, type TestDb } from '../setup/testDb'

const tenantA = randomUUID()
const tenantB = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let duplicate: (event: any) => Promise<any>
let parentEntity: string
let childEntity: string
let parentId: string
let childIds: string[]
let creatorRole: string
let readerRole: string
let headerOnlyRole: string
let otherRole: string
let userId: string

function event(tenantId: string, roleId: string, id: string) {
  return { context: { auth: { tenantId, roleId, sub: userId }, params: { entity: 'documentos', id } } }
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${tenantA}, 'Dup A'), (${tenantB}, 'Dup B')`
  const [roleA] = await admin`insert into roles (tenant_id, name) values (${tenantA}, 'Creador') returning id`
  const [roleRead] = await admin`insert into roles (tenant_id, name) values (${tenantA}, 'Lector') returning id`
  const [roleHeader] = await admin`insert into roles (tenant_id, name) values (${tenantA}, 'Solo encabezado') returning id`
  const [roleB] = await admin`insert into roles (tenant_id, name) values (${tenantB}, 'Creador') returning id`
  creatorRole = roleA!.id; readerRole = roleRead!.id; headerOnlyRole = roleHeader!.id; otherRole = roleB!.id
  const [person] = await admin`insert into people (email, password_hash, full_name) values ('duplicate@test.local', 'x', 'Duplicador') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantA}, ${creatorRole}, ${person!.id}) returning id`
  userId = user!.id

  const layout = { properties: [], relations: [{ entitySlug: 'partidas', fieldName: 'documento', visible: true, editable: true }], showActivity: true }
  const workflow = { enabled: true, field: 'estado', initial: 'borrador', states: { borrador: { locked: false, editableFields: [] }, cerrado: { locked: true, editableFields: [] } }, transitions: [{ from: 'borrador', to: 'cerrado', roles: 'all' }], rules: [{ type: 'required', when: { to: 'cerrado' }, fields: ['aprobacion'], mode: 'block', message: 'Falta aprobación' }] }
  const [parent] = await admin`insert into entities (tenant_id, name, slug, label_field, detail_layout, workflow_config) values (${tenantA}, 'Documentos', 'documentos', 'nombre', ${admin.json(layout as never)}, ${admin.json(workflow as never)}) returning id`
  const [child] = await admin`insert into entities (tenant_id, name, slug) values (${tenantA}, 'Partidas', 'partidas') returning id`
  parentEntity = parent!.id; childEntity = child!.id
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete) values (${creatorRole}, ${parentEntity}, true, true, true, true), (${creatorRole}, ${childEntity}, true, true, true, true), (${readerRole}, ${parentEntity}, true, false, false, false), (${headerOnlyRole}, ${parentEntity}, true, true, false, false), (${headerOnlyRole}, ${childEntity}, true, false, false, false)`
  await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values
    (${parentEntity}, 'nombre', 'Nombre', 'text', '{}'::jsonb),
    (${parentEntity}, 'folio', 'Folio', 'incremental', ${admin.json({ digits: 4 } as never)}),
    (${parentEntity}, 'estado', 'Estado', 'text', '{}'::jsonb),
    (${parentEntity}, 'total', 'Total', 'number', ${admin.json({ calculation: { kind: 'rollup', aggregate: 'sum', sourceEntity: 'partidas', relationField: 'documento', valueField: 'importe' } } as never)}),
    (${childEntity}, 'documento', 'Documento', 'relation', ${admin.json({ relationEntity: 'documentos' } as never)}),
    (${childEntity}, 'cantidad', 'Cantidad', 'number', '{}'::jsonb),
    (${childEntity}, 'precio', 'Precio', 'number', '{}'::jsonb),
    (${childEntity}, 'importe', 'Importe', 'number', ${admin.json({ calculation: { kind: 'formula', operator: 'multiply', leftField: 'cantidad', rightField: 'precio' } } as never)}),
    (${childEntity}, 'adjunto', 'Adjunto', 'file', '{}'::jsonb)`
  const [folioField] = await admin`select id from entity_fields where entity_id = ${parentEntity} and name = 'folio'`
  await admin`insert into entity_field_counters (entity_field_id, prefix, last_value) values (${folioField!.id}, '', 1)`
  const [source] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantA}, ${parentEntity}, ${admin.json({ nombre: 'Original', folio: '0001', estado: 'cerrado', total: 999 })}) returning id`
  parentId = source!.id
  const rows = await admin`insert into records (tenant_id, entity_id, custom_data) values
    (${tenantA}, ${childEntity}, ${admin.json({ documento: parentId, cantidad: 2, precio: 5, importe: 999, adjunto: randomUUID() })}),
    (${tenantA}, ${childEntity}, ${admin.json({ documento: parentId, cantidad: 3, precio: 7, importe: 999 })}) returning id`
  childIds = rows.map(row => row.id)

  const [otherEntity] = await admin`insert into entities (tenant_id, name, slug) values (${tenantB}, 'Documentos', 'documentos') returning id`
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create) values (${otherRole}, ${otherEntity!.id}, true, true)`

  process.env.APP_DATABASE_URL = testDb.appUrl
  vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<unknown>) => handler)
  vi.stubGlobal('getRouterParam', (request: any, name: string) => request.context.params[name])
  vi.stubGlobal('setResponseStatus', () => {})
  vi.stubGlobal('createError', createError)
  duplicate = (await import('../../server/api/records/[entity]/[id]/duplicate.post')).default
}, 60_000)

afterAll(async () => { await admin.end(); await testDb.stop() })

describe('POST duplicate (PostgreSQL real)', () => {
  it('duplica encabezado y partidas, regenera folio y recalcula valores sin tocar el original', async () => {
    const copy = await duplicate(event(tenantA, creatorRole, parentId))
    expect(copy.id).not.toBe(parentId)
    expect(copy.customData).toMatchObject({ nombre: 'Original', estado: 'borrador', total: 31, folio: '0002' })
    const lines = await admin`select id, custom_data from records where tenant_id = ${tenantA} and entity_id = ${childEntity} and custom_data->>'documento' = ${copy.id}`
    expect(lines).toHaveLength(2)
    expect(lines.every(line => !childIds.includes(line.id))).toBe(true)
    expect(lines.map(line => line.custom_data.importe).sort()).toEqual([10, 21])
    expect(lines.every(line => !('adjunto' in line.custom_data))).toBe(true)
    const originals = await admin`select custom_data from records where id in ${admin(childIds)}`
    expect(originals).toHaveLength(2)
    expect(originals.every(row => row.custom_data.importe === 999)).toBe(true)
    const activity = await admin`select details from record_activities where record_id = ${copy.id}`
    expect(activity[0]?.details.text).toBe('Duplicado de 0001')
  })

  it('genera un folio nuevo si el contador ya tiene valores previos', async () => {
    const copy = await duplicate(event(tenantA, creatorRole, parentId))
    expect(copy.customData.folio).toBe('0003')
  })

  it('rechaza sin permiso de crear y oculta el registro de otro tenant', async () => {
    await expect(duplicate(event(tenantA, readerRole, parentId))).rejects.toMatchObject({ statusCode: 403 })
    await expect(duplicate(event(tenantA, headerOnlyRole, parentId))).rejects.toMatchObject({ statusCode: 403 })
    await expect(duplicate(event(tenantB, otherRole, parentId))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('revierte encabezado, partidas y folio ante un fallo después de insertar el encabezado', async () => {
    await admin`insert into entity_fields (entity_id, name, label, data_type, is_required) values (${childEntity}, 'obligatorio', 'Obligatorio', 'text', true)`
    await admin`update records set custom_data = custom_data || '{"obligatorio":"válido"}'::jsonb where id = ${childIds[0]}`
    await admin`update records set created_at = now() - interval '1 day' where id = ${childIds[0]}`
    const before = await admin`select count(*)::int as count from records where tenant_id = ${tenantA}`
    const activitiesBefore = await admin`select count(*)::int as count from record_activities where tenant_id = ${tenantA}`
    const counterBefore = await admin`select last_value from entity_field_counters where entity_field_id in (select id from entity_fields where entity_id = ${parentEntity} and name = 'folio')`
    await expect(duplicate(event(tenantA, creatorRole, parentId))).rejects.toMatchObject({ statusCode: 422 })
    const after = await admin`select count(*)::int as count from records where tenant_id = ${tenantA}`
    expect(after[0]?.count).toBe(before[0]?.count)
    const activitiesAfter = await admin`select count(*)::int as count from record_activities where tenant_id = ${tenantA}`
    const counterAfter = await admin`select last_value from entity_field_counters where entity_field_id in (select id from entity_fields where entity_id = ${parentEntity} and name = 'folio')`
    expect(activitiesAfter[0]?.count).toBe(activitiesBefore[0]?.count)
    expect(counterAfter[0]?.last_value).toBe(counterBefore[0]?.last_value)
    await admin`delete from entity_fields where entity_id = ${childEntity} and name = 'obligatorio'`
  })

  it('duplica un registro sin partidas', async () => {
    const [empty] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantA}, ${parentEntity}, ${admin.json({ nombre: 'Sin partidas', estado: 'cerrado' })}) returning id`
    const copy = await duplicate(event(tenantA, creatorRole, empty!.id))
    expect(copy.customData).toMatchObject({ nombre: 'Sin partidas', estado: 'borrador', total: 0 })
    const lines = await admin`select id from records where entity_id = ${childEntity} and custom_data->>'documento' = ${copy.id}`
    expect(lines).toHaveLength(0)
  })

  it('dispara on_create para encabezado y partidas después del commit; un flujo fallido no revierte la copia', async () => {
    const [headerTrigger] = await admin`insert into triggers (tenant_id, entity_id, name, trigger_event, condition) values (${tenantA}, ${parentEntity}, 'Documento copiado', 'on_create', ${admin.json({ always: true })}) returning id`
    const [lineTrigger] = await admin`insert into triggers (tenant_id, entity_id, name, trigger_event, condition) values (${tenantA}, ${childEntity}, 'Partida copiada', 'on_create', ${admin.json({ always: true })}) returning id`
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config) values (${tenantA}, ${lineTrigger!.id}, 'email', ${admin.json({})})`

    const copy = await duplicate(event(tenantA, creatorRole, parentId))
    const lines = await admin`select id from records where tenant_id = ${tenantA} and entity_id = ${childEntity} and custom_data->>'documento' = ${copy.id}`
    expect(lines).toHaveLength(2)
    const ids = [copy.id, ...lines.map(line => line.id)]
    let logs = await admin`select trigger_id, record_id, status, request_payload from trigger_logs where tenant_id = ${tenantA} and record_id in ${admin(ids)}`
    for (let attempt = 0; attempt < 50 && logs.length < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      logs = await admin`select trigger_id, record_id, status, request_payload from trigger_logs where tenant_id = ${tenantA} and record_id in ${admin(ids)}`
    }
    expect(logs).toHaveLength(3)
    const headerLog = logs.find(log => log.trigger_id === headerTrigger!.id)
    expect(headerLog).toMatchObject({ record_id: copy.id, status: 'success' })
    expect(headerLog?.request_payload.record.data.total).toBe(31)
    const lineLogs = logs.filter(log => log.trigger_id === lineTrigger!.id)
    expect(lineLogs).toHaveLength(2)
    expect(lineLogs.every(log => log.status === 'failed')).toBe(true)
    expect(lineLogs.map(log => log.request_payload.record.data.importe).sort()).toEqual([10, 21])
    const persisted = await admin`select id from records where id in ${admin(ids)}`
    expect(persisted).toHaveLength(3)
  })
})
