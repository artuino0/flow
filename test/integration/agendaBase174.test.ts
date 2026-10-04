import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withSystemRecordAccess } from '../../server/utils/recordActorContext'

let database: TestDb
let admin: postgres.Sql
let agenda: typeof import('../../server/utils/agendaTemplate')
let client: typeof import('../../server/utils/agendaClient')
let modules: typeof import('../../server/utils/moduleEntities')
let fields: typeof import('../../server/utils/moduleEntityFields')
let billing: typeof import('../../server/utils/billing')
let validate: typeof import('../../server/utils/blueprint/validate')
let exporter: typeof import('../../server/utils/blueprint/export')
const tenantId = randomUUID(), linkedTenant = randomUUID(), collisionTenant = randomUUID()
let userId: string

beforeAll(async () => {
  database = await createTestDb()
  admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl
  for (const id of [tenantId, linkedTenant, collisionTenant]) {
    await admin`insert into tenants (id, name, slug) values (${id}, 'Agenda 174', ${'agenda-' + id})`
    await admin`insert into roles (tenant_id, name, is_system) values (${id}, 'Administrador', true)`
  }
  const [person] = await admin`insert into people (email, password_hash, full_name) values ('agenda174@test.local', 'x', 'Prueba Agenda') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantId}, (select id from roles where tenant_id=${tenantId} and is_system), ${person.id}) returning id`
  userId = user.id
  agenda = await import('../../server/utils/agendaTemplate')
  client = await import('../../server/utils/agendaClient')
  modules = await import('../../server/utils/moduleEntities')
  fields = await import('../../server/utils/moduleEntityFields')
  billing = await import('../../server/utils/billing')
  validate = await import('../../server/utils/blueprint/validate')
  exporter = await import('../../server/utils/blueprint/export')
}, 60_000)
afterAll(async () => { await admin?.end(); await database?.stop(); vi.unstubAllGlobals() })

describe('Agenda base con PostgreSQL local y RLS', () => {
  it('instala el plan preconfigurado, no duplica ni consume módulos', async () => {
    await agenda.installAgendaTemplate(tenantId)
    await agenda.installAgendaTemplate(tenantId)
    const installed = await admin`select * from entities where tenant_id=${tenantId} and template_key='agenda'`
    expect(installed).toHaveLength(5)
    for (const module of agenda.agendaBlueprint.modules) expect(installed.find(row => row.slug === module.slug)?.icon).toBe(module.icon)
    expect(installed.find(row => row.slug === 'agenda-citas')?.workflow_config).toEqual(agenda.agendaStateWorkflow)
    expect(installed.find(row => row.slug === 'agenda-citas')?.calendar_config).toMatchObject({ enabled: true, startDateField: 'fecha', groupByField: 'personal' })
    expect(await admin`select id from blueprint_applications where tenant_id=${tenantId}`).toHaveLength(1)
    expect(await admin`select id from roles where tenant_id=${tenantId} and name in ('Recepción', 'Personal')`).toHaveLength(2)
    expect((await billing.getPlanUsage(tenantId)).usage.find(item => item.concept === 'modules')?.used).toBe(0)
    await modules.createEntity(tenantId, { name: 'Propio', slug: 'propio', description: null })
    expect((await billing.getPlanUsage(tenantId)).usage.find(item => item.concept === 'modules')?.used).toBe(1)
  }, 60_000)

  it('completa una instalación anterior sin cambiar campos, calendario, permisos ni registros', async () => {
    const [base] = await admin`select * from entities where tenant_id=${tenantId} and slug='agenda-citas'`
    const previousFields = await admin`select * from entity_fields where entity_id=${base!.id} order by id`
    const permissions = await admin`select * from role_entity_permissions where entity_id=${base!.id} order by role_id`
    const [record] = await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenantId},${base!.id},'{"asunto":"Anterior","estado":"no_asistio"}') returning *`
    await admin`update entities set icon=null,workflow_config=null where tenant_id=${tenantId} and template_key='agenda'`
    await agenda.installAgendaTemplate(tenantId)
    await agenda.installAgendaTemplate(tenantId)
    const installed = await admin`select * from entities where tenant_id=${tenantId} and template_key='agenda'`
    for (const module of agenda.agendaBlueprint.modules) expect(installed.find(row => row.slug === module.slug)?.icon).toBe(module.icon)
    const upgraded = installed.find(row => row.slug === 'agenda-citas')!
    expect(upgraded.workflow_config).toEqual(agenda.agendaStateWorkflow)
    expect(upgraded.calendar_config).toEqual(base!.calendar_config)
    expect(await admin`select * from entity_fields where entity_id=${base!.id} order by id`).toEqual(previousFields)
    expect(await admin`select * from role_entity_permissions where entity_id=${base!.id} order by role_id`).toEqual(permissions)
    expect((await admin`select * from records where id=${record!.id}`)[0]).toEqual(record)
  })

  it('conserva iconos y flujos personalizados, incluso deshabilitados, y Select extendidos', async () => {
    const [base] = await admin`select id from entities where tenant_id=${tenantId} and slug='agenda-citas'`
    for (const enabled of [true, false]) {
      const custom = { ...agenda.agendaStateWorkflow, enabled, initial: 'confirmada', transitions: [] }
      await admin`update entities set icon='Star',workflow_config=${admin.json(custom)} where id=${base!.id}`
      await agenda.installAgendaTemplate(tenantId)
      expect((await admin`select icon,workflow_config from entities where id=${base!.id}`)[0]).toEqual({ icon: 'Star', workflow_config: custom })
    }
    const [field] = await admin`select * from entity_fields where entity_id=${base!.id} and name='estado'`
    const rules = { ...field!.validation_rules, options: [...field!.validation_rules.options, { value: 'propio', label: 'Propio' }] }
    await admin`update entity_fields set validation_rules=${admin.json(rules)} where id=${field!.id}`
    await admin`update entities set workflow_config=null where id=${base!.id}`
    await agenda.installAgendaTemplate(tenantId)
    expect((await admin`select workflow_config from entities where id=${base!.id}`)[0]!.workflow_config).toBeNull()
    expect((await admin`select validation_rules from entity_fields where id=${field!.id}`)[0]!.validation_rules).toEqual(rules)
    await admin`update entity_fields set validation_rules=${admin.json(field!.validation_rules)} where id=${field!.id}`
    await agenda.installAgendaTemplate(tenantId)
    expect((await admin`select icon,workflow_config from entities where id=${base!.id}`)[0]).toEqual({ icon: 'Star', workflow_config: agenda.agendaStateWorkflow })
  })

  it('el motor permite exactamente las ocho transiciones y ningún retorno de estados finales', async () => {
    const workflow = await import('../../server/utils/stateWorkflow')
    const { withTenant } = await import('../../server/db')
    const [base] = await admin`select id from entities where tenant_id=${tenantId} and slug='agenda-citas'`
    const [record] = await admin`select id from records where entity_id=${base!.id} limit 1`
    const [role] = await admin`select id from roles where tenant_id=${tenantId} and name='Personal'`
    const allowed = ['agendada:confirmada', 'agendada:cancelada', 'agendada:no_asistio', 'confirmada:en_curso', 'confirmada:cancelada', 'confirmada:no_asistio', 'en_curso:terminada', 'en_curso:cancelada']
    for (const from of Object.keys(agenda.agendaStateWorkflow.states)) for (const to of Object.keys(agenda.agendaStateWorkflow.states)) {
      const change = withSystemRecordAccess(() => withTenant(tenantId, tx => workflow.enforceWorkflowChange(tx, { tenantId, entityId: base!.id, roleId: role!.id, userId, recordId: record!.id, current: { estado: from }, next: { estado: to }, changedFields: ['estado'] })))
      if (from === to) await expect(change).resolves.toBeNull()
      else if (allowed.includes(`${from}:${to}`)) await expect(change).resolves.toMatchObject({ from, to, roles: 'all' })
      else await expect(change).rejects.toMatchObject({ statusCode: 403 })
    }
    await admin`delete from records where id=${record!.id}`
  })

  it('vincula un módulo elegido sin alterarlo ni crear Clientes de plantilla', async () => {
    const existing = await modules.createEntity(linkedTenant, { name: 'Clientes', slug: 'personas-propias', description: null })
    await fields.createEntityField(linkedTenant, existing.id, { name: 'razon', label: 'Nombre', dataType: 'text', isRequired: false, validationRules: {} })
    await agenda.installAgendaTemplate(linkedTenant, { mode: 'link', entityId: existing.id })
    await agenda.installAgendaTemplate(linkedTenant, { mode: 'create' })
    expect(await admin`select id from entities where tenant_id=${linkedTenant} and template_key='agenda'`).toHaveLength(4)
    expect(await admin`select id from entities where tenant_id=${linkedTenant} and slug='agenda-clientes'`).toHaveLength(0)
    expect(await admin`select name from entity_fields where entity_id=${existing.id}`).toEqual([{ name: 'razon' }])
    expect((await admin`select icon,workflow_config from entities where id=${existing.id}`)[0]).toEqual({ icon: null, workflow_config: null })
    expect((await client.agendaInstallOptions(linkedTenant)).clientSlug).toBe(existing.slug)
  }, 60_000)

  it('rechaza destino sin texto, de otro tenant y colisiones sin fusionar', async () => {
    const blank = await modules.createEntity(collisionTenant, { name: 'Vacío', slug: 'vacio', description: null })
    await expect(agenda.installAgendaTemplate(collisionTenant, { mode: 'link', entityId: blank.id })).rejects.toMatchObject({ statusCode: 422 })
    const [foreign] = await admin`select id from entities where tenant_id=${linkedTenant} and slug='personas-propias'`
    await expect(agenda.installAgendaTemplate(collisionTenant, { mode: 'link', entityId: foreign.id })).rejects.toMatchObject({ statusCode: 422 })
    await modules.createEntity(collisionTenant, { name: 'Citas propias', slug: 'agenda-citas', description: null })
    await expect(agenda.installAgendaTemplate(collisionTenant)).rejects.toMatchObject({ statusCode: 422 })
    expect(await admin`select id from entities where tenant_id=${collisionTenant} and template_key='agenda'`).toHaveLength(0)
    await agenda.upgradeAgendaTemplate(collisionTenant)
    expect((await admin`select icon,workflow_config from entities where tenant_id=${collisionTenant} and slug='agenda-citas'`)[0]).toEqual({ icon: null, workflow_config: null })
  })

  it('protege entidad y seis campos; permite etiquetas, permisos, campos y partidas propias', async () => {
    const options = await client.agendaInstallOptions(tenantId)
    const base = options.base!
    await expect(modules.deleteEntity(tenantId, base.id)).rejects.toMatchObject({ statusCode: 422 })
    await expect(modules.updateEntity(tenantId, base.id, { isActive: false })).rejects.toMatchObject({ statusCode: 422 })
    await modules.updateEntity(tenantId, base.id, { name: 'Mis citas', description: 'Agenda operativa' })
    const core = await admin`select * from entity_fields where entity_id=${base.id} and name in ('fecha','hora','duracion_minutos','personal','estado','cliente')`
    for (const field of core) {
      await expect(fields.deleteEntityField(tenantId, field.id)).rejects.toBeInstanceOf(fields.ProtectedFieldError)
      await expect(fields.updateEntityField(tenantId, field.id, { dataType: field.data_type === 'text' ? 'date' : 'text' }, userId)).rejects.toBeInstanceOf(fields.ProtectedFieldError)
      await withSystemRecordAccess(() => fields.updateEntityField(tenantId, field.id, { label: field.label + ' visible' }, userId))
    }
    const extra = await fields.createEntityField(tenantId, base.id, { name: 'motivo', label: 'Motivo', dataType: 'text', isRequired: false, validationRules: {} })
    await fields.updateEntityField(tenantId, extra.id, { label: 'Motivo propio' }, userId)
    await expect(fields.deleteEntityField(tenantId, extra.id)).resolves.toBe('deleted')
    const blueprint = await exporter.exportBlueprint(tenantId)
    expect(blueprint.modules.find(module => module.slug === 'agenda-citas')?.systemTemplate).toBe('agenda')
    const ownLines = { version: 1, summary: 'Partidas', associations: [], modules: [
      { ref: 'agenda-citas', slug: 'agenda-citas', name: 'Mis citas', kind: 'hecho', action: 'extend', fields: [], lines: [{ childRef: 'partidas-propias', relationField: 'cita' }] },
      { ref: 'partidas-propias', slug: 'partidas-propias', name: 'Partidas de citas', kind: 'hecho', action: 'create', fields: [{ name: 'cita', label: 'Cita', dataType: 'relation', validationRules: { relationEntity: 'agenda-citas' } }, { name: 'nota', label: 'Nota', dataType: 'text' }] }
    ] }
    expect((await validate.validateBlueprint(tenantId, ownLines)).errors.filter(error => error.code !== 'plan_limit')).toEqual([])
    const duplicate = { version: 1, summary: 'Otra agenda', associations: [], modules: [{ ref: 'turnos', slug: 'turnos', name: 'Turnos', action: 'create', kind: 'hecho', fields: [] }] }
    expect((await validate.validateBlueprint(tenantId, duplicate)).errors.some(error => error.code === 'agenda_base_exists')).toBe(true)
  }, 60_000)

  it('cambia Cliente en forma atómica, avisa y conserva incluso citas borradas', async () => {
    const options = await client.agendaInstallOptions(tenantId)
    const base = options.base!
    const target = await modules.createEntity(tenantId, { name: 'Contactos', slug: 'contactos', description: null, moduleKind: 'dimension' })
    await fields.createEntityField(tenantId, target.id, { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: false, validationRules: {} })
    const oldClient = randomUUID()
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantId}, ${base.id}, ${admin.json({ asunto: 'Conservar', cliente: oldClient })})`
    await admin`insert into records (tenant_id, entity_id, custom_data, deleted_at) values (${tenantId}, ${base.id}, ${admin.json({ asunto: 'Papelera', cliente: oldClient })}, now())`
    await expect(client.changeAgendaClient(tenantId, target.id, userId, false)).rejects.toMatchObject({ statusCode: 422 })
    expect((await client.agendaInstallOptions(tenantId)).clientSlug).toBe('agenda-clientes')
    const result = await client.changeAgendaClient(tenantId, target.id, userId, true)
    expect(result.affectedRecords).toBe(2)
    expect(result.archiveField).toBe('cliente_anterior_1')
    const records = await admin`select custom_data from records where tenant_id=${tenantId} and entity_id=${base.id}`
    expect(records).toHaveLength(2)
    for (const row of records) { expect(row.custom_data.cliente_anterior_1).toBe(oldClient); expect(row.custom_data).not.toHaveProperty('cliente') }
    expect((await client.agendaInstallOptions(tenantId)).clientSlug).toBe('contactos')
    expect((await client.changeAgendaClient(tenantId, target.id, userId, true)).archiveField).toBeNull()
    await agenda.installAgendaTemplate(tenantId)
    expect((await client.agendaInstallOptions(tenantId)).clientSlug).toBe('contactos')
  }, 60_000)
})
