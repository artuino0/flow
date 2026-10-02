import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createTestDb, type TestDb } from '../setup/testDb'
import { blueprintApplications } from '../../server/db/schema'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { sql } from 'drizzle-orm'

const tenantId = randomUUID()
const otherTenant = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let blueprint: typeof import('../../server/utils/blueprint/apply')
let validator: typeof import('../../server/utils/blueprint/validate')
let exporter: typeof import('../../server/utils/blueprint/export')
let withTenant: typeof import('../../server/db').withTenant
let template: Record<string, unknown>
let createRecord: (event: any) => Promise<any>
let adminRoleId: string
let userId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name, slug) values (${tenantId}, 'Taller', 'taller-prueba'), (${otherTenant}, 'Otro', 'otro-taller')`
  const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Administrador', true) returning id`
  adminRoleId = role.id
  await admin`insert into roles (tenant_id, name, is_system) values (${otherTenant}, 'Administrador', true)`
  const [person] = await admin`insert into people (email, password_hash, full_name) values ('blueprint@test.local', 'x', 'Blueprint Tester') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantId}, ${adminRoleId}, ${person.id}) returning id`
  userId = user.id
  process.env.APP_DATABASE_URL = testDb.appUrl
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<unknown>) => handler)
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event.context.params?.[name])
  vi.stubGlobal('readValidatedBody', async (event: any, parse: (body: unknown) => unknown) => parse(event.context.body))
  vi.stubGlobal('readBody', async (event: any) => event.context.body)
  vi.stubGlobal('setResponseStatus', () => {})
  ;({ withTenant } = await import('../../server/db'))
  blueprint = await import('../../server/utils/blueprint/apply')
  validator = await import('../../server/utils/blueprint/validate')
  exporter = await import('../../server/utils/blueprint/export')
  createRecord = (await import('../../server/api/records/[entity]/index.post')).default
  template = JSON.parse(await readFile(new URL('../../data/blueprints/taller-mecanico.json', import.meta.url), 'utf8'))
}, 60_000)

afterAll(async () => { await admin.end(); await testDb.stop() })

describe('blueprint (Postgres real con RLS)', () => {
  it('instala el taller completo, exporta la estructura y no aplica cambios al reimportarla', async () => {
    const checked = await validator.validateBlueprint(tenantId, template)
    expect(checked.errors).toEqual([])
    expect(await admin`select id from tenant_subscriptions where tenant_id = ${tenantId}`).toHaveLength(0)
    const first = await blueprint.applyBlueprint(tenantId, null, template, 'taller-1')
    expect(first.modules).toHaveLength(6)
    expect(first.associations).toEqual(['especialidades-tecnicos'])
    expect(first.layouts).toEqual(['ordenes-servicio'])
    expect(first.workflows).toEqual(['ordenes-servicio'])
    const saved = await admin`select slug, module_kind, detail_layout, workflow_config from entities where tenant_id = ${tenantId}`
    expect(saved).toHaveLength(6)
    expect(saved.find(row => row.slug === 'tipos-servicio')?.module_kind).toBe('dimension')
    expect(saved.find(row => row.slug === 'ordenes-servicio')?.detail_layout.relations[0]).toMatchObject({ entitySlug: 'refacciones', fieldName: 'orden', editable: true, totals: ['importe'] })
    expect(saved.find(row => row.slug === 'ordenes-servicio')?.workflow_config.rules).toHaveLength(2)
    const exported = await exporter.exportBlueprint(tenantId)
    const roundTrip = await validator.validateBlueprint(tenantId, exported)
    expect(roundTrip.errors).toEqual([])
    const noOp = await blueprint.applyBlueprint(tenantId, null, exported, 'export-1')
    expect(noOp.modules).toEqual([])
    expect(noOp.fields).toEqual([])
    expect(noOp.layouts).toEqual([])
    const reapplied = await blueprint.applyBlueprint(tenantId, null, template, 'taller-2')
    expect(reapplied.modules).toEqual([])
    expect(reapplied.fields).toEqual([])
    expect(reapplied.associations).toEqual([])
    expect(reapplied.layouts).toEqual([])
    expect(await admin`select id from entities where tenant_id = ${tenantId}`).toHaveLength(6)
    expect(await blueprint.applyBlueprint(tenantId, null, template, 'taller-1')).toEqual(first)
    expect(await admin`select id from blueprint_applications where tenant_id = ${tenantId} and idempotency_key = 'taller-1'`).toHaveLength(1)
  }, 60_000)

  it('fusiona Clientes con Cliente existente y redirige las referencias', async () => {
    const [existing] = await admin`insert into entities (tenant_id, name, slug, module_kind) values (${otherTenant}, 'Cliente', 'cliente', 'hecho') returning id`
    await admin`insert into entity_fields (entity_id, name, label, data_type) values (${existing.id}, 'nombre', 'Nombre', 'text')`
    const checked = await validator.validateBlueprint(otherTenant, template)
    expect(checked.errors).toEqual([])
    expect(checked.merges).toMatchObject([{ from: 'clientes', to: 'cliente', discardedFields: ['nombre'] }])
    await blueprint.applyBlueprint(otherTenant, null, template, 'taller-fusion')
    expect(await admin`select id from entities where tenant_id = ${otherTenant} and slug = 'clientes'`).toHaveLength(0)
    const vehicle = await admin`select validation_rules from entity_fields where name = 'cliente' and entity_id = (select id from entities where tenant_id = ${otherTenant} and slug = 'vehiculos')`
    expect(vehicle[0].validation_rules.relationEntity).toBe('cliente')
    expect(await admin`select name from entity_fields where entity_id = ${existing.id}`).toHaveLength(3)
  }, 60_000)

  it('permite crear registros reales y recalcula el rollup de la orden', async () => {
    // La invocación directa del handler no instala el contexto de petición de Nitro.
    const create = (entity: string, customData: Record<string, unknown>) => withRecordActor({ userId, roleId: adminRoleId }, () => createRecord({ context: { auth: { tenantId, roleId: adminRoleId, sub: userId }, params: { entity }, body: { customData } } }))
    const client = await create('clientes', { nombre: 'Ana Pérez' })
    const vehicle = await create('vehiculos', { placas: 'ABC-123', cliente: client.id })
    const technician = await create('tecnicos', { nombre: 'Luis' })
    const order = await create('ordenes-servicio', { fecha: '2026-09-27', vehiculo: vehicle.id, tecnico: technician.id })
    expect(order.customData.total_refacciones).toBe('0.00')
    const line = await create('refacciones', { orden: order.id, descripcion: 'Filtro', cantidad: 2, precio_unitario: '15.00' })
    expect(line.customData.importe).toBe('30.00')
    const [updated] = await admin`select custom_data from records where id = ${order.id}`
    expect(updated.custom_data.total_refacciones).toBe('30.00')
  }, 60_000)

  it('la aplicación interna de un plano marca registros existentes para revalidar', async () => {
    const fresh = randomUUID()
    await admin`insert into tenants (id, name, slug) values (${fresh}, 'Revalidación interna', ${`dirty-${fresh}`})`
    await admin`insert into roles (tenant_id, name, is_system) values (${fresh}, 'Administrador', true)`
    const [entity] = await admin`insert into entities (tenant_id, name, slug, module_kind) values (${fresh}, 'Datos', 'datos', 'hecho') returning id`
    await admin`insert into records (tenant_id, entity_id, custom_data, is_dirty) values (${fresh}, ${entity.id}, '{}'::jsonb, false)`
    await blueprint.applyBlueprint(fresh, null, { version: 1, summary: 'Campo nuevo', modules: [{ ref: 'datos', action: 'extend', kind: 'hecho', name: 'Datos', slug: 'datos', fields: [{ name: 'nota', label: 'Nota', dataType: 'text' }] }], associations: [] }, 'dirty')
    expect(await admin`select is_dirty from records where tenant_id = ${fresh}`).toMatchObject([{ is_dirty: true }])
    const mode = await withTenant(fresh, tx => tx.execute(sql`select current_setting('app.record_system', true) as mode`))
    expect(mode[0]?.mode).toBe('off')
  }, 60_000)

  it('instala el mismo plano desde el CLI sin duplicar en una segunda ejecución', async () => {
    const fresh = randomUUID()
    await admin`insert into tenants (id, name, slug) values (${fresh}, 'CLI', 'cli-taller')`
    await admin`insert into roles (tenant_id, name, is_system) values (${fresh}, 'Administrador', true)`
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const args = [fileURLToPath(new URL('../../scripts/installBlueprint.mjs', import.meta.url)), 'cli-taller', fileURLToPath(new URL('../../data/blueprints/taller-mecanico.json', import.meta.url))]
    const env = { ...process.env, DATABASE_URL: testDb.adminUrl, APP_DATABASE_URL: testDb.appUrl }
    try {
      execFileSync(process.execPath, args, { cwd: root, env, stdio: 'pipe', timeout: 20_000 })
      execFileSync(process.execPath, args, { cwd: root, env, stdio: 'pipe', timeout: 20_000 })
    } catch (error) {
      const child = error as { stdout?: Buffer; stderr?: Buffer }
      throw new Error(`CLI: ${child.stdout?.toString() ?? ''} ${child.stderr?.toString() ?? ''}`, { cause: error })
    }
    expect(await admin`select id from entities where tenant_id = ${fresh}`).toHaveLength(6)
    expect(await admin`select id from blueprint_applications where tenant_id = ${fresh}`).toHaveLength(1)
  }, 60_000)

  it('reporta referencias, campos y expresiones inválidas con ruta', async () => {
    const fresh = randomUUID()
    await admin`insert into tenants (id, name, slug) values (${fresh}, 'Errores', 'errores-taller')`
    await admin`insert into roles (tenant_id, name, is_system) values (${fresh}, 'Administrador', true)`
    const invalid = structuredClone(template) as { modules: Array<{ fields: Array<{ validationRules?: Record<string, unknown> }> }> }
    invalid.modules[1].fields[3].validationRules = { relationEntity: 'fantasma' }
    invalid.modules[4].fields[7].validationRules = { calculation: { kind: 'expression', expression: 'campo_fantasma + 1' } }
    const checked = await validator.validateBlueprint(fresh, invalid)
    expect(checked.errors.map(error => error.path)).toContain('modules[1].fields[3].validationRules.relationEntity')
    expect(checked.errors.map(error => error.path)).toContain('modules[4].fields[7].validationRules.calculation.expression')
  })

  it('rechaza un campo existente en extend, un flujo inválido y slugs duplicados', async () => {
    const extend = { version: 1, summary: 'Campo repetido', modules: [{ ref: 'cliente', action: 'extend', kind: 'hecho', name: 'Cliente', slug: 'cliente', fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] }], associations: [] }
    const field = await validator.validateBlueprint(otherTenant, extend)
    expect(field.errors.map(error => error.path)).toContain('modules[0].fields[0].name')
    const invalidWorkflow = structuredClone(template) as { modules: Array<{ workflow?: { initial: string } }> }
    invalidWorkflow.modules[4].workflow!.initial = 'desconocido'
    const workflow = await validator.validateBlueprint(randomUUID(), invalidWorkflow)
    // La forma del flujo se rechaza antes de consultar el tenant.
    expect(workflow?.errors.map(error => error.path)).toContain('modules[4].workflow.initial')
    const duplicate = { version: 1, summary: 'Duplicado', modules: [
      { ref: 'uno', action: 'create', kind: 'hecho', name: 'Uno', slug: 'repetido', fields: [] },
      { ref: 'dos', action: 'create', kind: 'hecho', name: 'Dos', slug: 'repetido', fields: [] }
    ], associations: [] }
    const slug = await validator.validateBlueprint(otherTenant, duplicate)
    expect(slug.errors.map(error => error.path)).toContain('modules[1].slug')
    const malformed = await validator.validateBlueprint(otherTenant, { version: 2, summary: 'Error', modules: [], associations: [] })
    expect(malformed.errors).toContainEqual({ path: 'version', message: 'El valor no está permitido', code: 'invalid_literal' })
  })

  it('rechaza cambios silenciosos a asociaciones y diseños exportados', async () => {
    const [client] = await admin`select id from entities where tenant_id = ${tenantId} and slug = 'clientes'`
    const [vehicle] = await admin`select id from entities where tenant_id = ${tenantId} and slug = 'vehiculos'`
    await admin`insert into relation_definitions (tenant_id, name, source_entity_id, target_entity_id) values (${tenantId}, 'propiedad', ${client.id}, ${vehicle.id})`
    const association = await validator.validateBlueprint(tenantId, { version: 1, summary: 'Cambio', modules: [], associations: [{ name: 'propiedad', sourceRef: 'vehiculos', targetRef: 'clientes' }] })
    expect(association.errors.map(error => error.path)).toContain('associations[0].name')
    const exported = await exporter.exportBlueprint(tenantId)
    const order = exported.modules.find(module => module.slug === 'ordenes-servicio')!
    order.detailLayout!.showActivity = !order.detailLayout!.showActivity
    const layout = await validator.validateBlueprint(tenantId, exported)
    expect(layout.errors.map(error => error.path)).toContain(`modules[${exported.modules.indexOf(order)}].detailLayout`)
  })

  it('revierte todo si falla la validación final del flujo después de crear los módulos', async () => {
    const fresh = randomUUID()
    await admin`insert into tenants (id, name, slug) values (${fresh}, 'Rollback', 'rollback-taller')`
    await admin`insert into roles (tenant_id, name, is_system) values (${fresh}, 'Administrador', true)`
    await admin.unsafe(`create function blueprint_test_fail() returns trigger language plpgsql as $$ begin if new.tenant_id = '${fresh}'::uuid and new.workflow_config is not null then raise exception 'fallo forzado'; end if; return new; end $$`)
    await admin.unsafe('create trigger blueprint_test_fail_trigger before update on entities for each row execute function blueprint_test_fail()')
    await expect(blueprint.applyBlueprint(fresh, null, template, 'rollback-1')).rejects.toThrow()
    await admin.unsafe('drop trigger blueprint_test_fail_trigger on entities; drop function blueprint_test_fail()')
    expect(await admin`select id from entities where tenant_id = ${fresh}`).toHaveLength(0)
    expect(await admin`select id from blueprint_applications where tenant_id = ${fresh}`).toHaveLength(0)
  }, 60_000)

  it('devuelve plan_limit sin escribir cuando la cuota de módulos es cero', async () => {
    const fresh = randomUUID()
    await admin`insert into tenants (id, name, slug) values (${fresh}, 'Sin cuota', 'sin-cuota-taller')`
    await admin`insert into roles (tenant_id, name, is_system) values (${fresh}, 'Administrador', true)`
    await admin`update plan_limits set value = 0 where plan_id = (select id from plans where key = 'starter') and concept = 'modules'`
    const checked = await validator.validateBlueprint(fresh, template)
    expect(checked.errors).toContainEqual(expect.objectContaining({ path: 'modules', code: 'plan_limit' }))
    await expect(blueprint.applyBlueprint(fresh, null, template, 'sin-cuota-1')).rejects.toMatchObject({ statusCode: 402 })
    expect(await admin`select id from entities where tenant_id = ${fresh}`).toHaveLength(0)
    expect(await admin`select id from blueprint_applications where tenant_id = ${fresh}`).toHaveLength(0)
    expect(await admin`select id from tenant_subscriptions where tenant_id = ${fresh}`).toHaveLength(0)
  }, 60_000)

  it('no deja ver auditorías de otro tenant bajo RLS', async () => {
    const visible = await withTenant(otherTenant, tx => tx.select().from(blueprintApplications))
    expect(visible).toHaveLength(1)
    expect(visible[0].tenantId).toBe(otherTenant)
  })

  it('reserva los endpoints a administradores y devuelve 422 con rutas', async () => {
    const [reader] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Lector', false) returning id`
    const validateApi = (await import('../../server/api/blueprints/validate.post')).default
    const applyApi = (await import('../../server/api/blueprints/apply.post')).default
    const event = (roleId: string, body: unknown) => ({ context: { auth: { tenantId, roleId, sub: userId }, body } })
    await expect(validateApi(event(reader.id, template) as never)).rejects.toMatchObject({ statusCode: 403 })
    await expect(applyApi(event(reader.id, { blueprint: template, idempotencyKey: 'lector' }) as never)).rejects.toMatchObject({ statusCode: 403 })
    const invalid = { version: 1, summary: 'Referencia ajena', modules: [{ ref: 'extra', action: 'create', kind: 'hecho', name: 'Extra', slug: 'extra', fields: [{ name: 'ajena', label: 'Ajena', dataType: 'relation', validationRules: { relationEntity: 'solo-otro-tenant' } }] }], associations: [] }
    await expect(applyApi(event(adminRoleId, { blueprint: invalid, idempotencyKey: 'invalid' }) as never)).rejects.toMatchObject({ statusCode: 422, data: { errors: expect.arrayContaining([expect.objectContaining({ path: 'modules[0].fields[0].validationRules.relationEntity' })]) } })
  })
})


describe('HU-ERD-152: catálogo en planos del diseñador', () => {
  it('el CRM real archivado sigue siendo válido sin red y acepta formatos nuevos', async () => {
    const crm: unknown = JSON.parse(await readFile(new URL('../fixtures/hu152-crm.json', import.meta.url), 'utf8'))
    const [tenant] = await admin`insert into tenants (name, slug) values ('CRM 152', 'crm152') returning id`
    await admin`insert into tenant_subscriptions (tenant_id, plan_id, status) select ${tenant.id}, id, 'active' from plans where key = 'empresarial'`
    const original = await validator.validateBlueprint(tenant.id, crm)
    expect(original.errors).toEqual([])
    expect(original.normalized).not.toBeNull()
    const enhanced = structuredClone(original.normalized!)
    const module = enhanced.modules.find(item => item.kind === 'hecho')!
    module.fields.push({ name: 'correo152', label: 'Correo validado', dataType: 'text', validationRules: { format: 'email', trim: true, case: 'lower', notBlank: true } })
    expect((await validator.validateBlueprint(tenant.id, enhanced)).errors).toEqual([])
  })
  it('aplica referencias de fecha y filtros aunque sus campos destino se declaren después', async () => {
    const [tenant] = await admin`insert into tenants (name, slug) values ('Referencias 152', 'references152') returning id`
    const proposal = { version: 1, summary: 'Validaciones nuevas', modules: [{ ref: 'referencias152', slug: 'referencias152', name: 'Referencias 152', action: 'create', kind: 'dimension', fields: [
      { name: 'fin', label: 'Fin', dataType: 'date', validationRules: { after: 'inicio' } },
      { name: 'inicio', label: 'Inicio', dataType: 'date', validationRules: { minRelative: 0, default: 'today' } },
      { name: 'destino', label: 'Destino', dataType: 'relation', validationRules: { relationEntity: 'referencias152', eligibleFilter: { field: 'activo', value: true } } },
      { name: 'activo', label: 'Activo', dataType: 'boolean', validationRules: { default: true } }
    ] }], associations: [] }
    expect((await validator.validateBlueprint(tenant.id, proposal)).errors).toEqual([])
    const result = await blueprint.applyBlueprint(tenant.id, null, proposal, 'referencias152')
    expect(result.fields).toHaveLength(4)
    const exported = await exporter.exportBlueprint(tenant.id)
    expect(exported.modules[0].fields.find(field => field.name === 'fin')?.validationRules).toEqual({ after: 'inicio' })
    const invalid = structuredClone(proposal)
    invalid.modules[0].fields[0].validationRules = { after: 'activo' }
    expect((await validator.validateBlueprint(otherTenant, invalid)).errors.some(error => error.path.endsWith('validationRules.after'))).toBe(true)
  })
})

describe('HU-ERD-152: registros con defaults y normalización', () => {
  it('POST aplica defaults antes del cálculo; PUT/PATCH no reaplican defaults y respetan fechas cruzadas', async () => {
    const { createEntityField } = await import('../../server/utils/moduleEntityFields')
    const { dateDay } = await import('../../server/utils/fieldValidations/registry')
    const [entity] = await admin`insert into entities (tenant_id, name, slug, module_kind) values (${tenantId}, 'Defaults 152', 'defaults152', 'dimension') returning id`
    await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete) values (${adminRoleId}, ${entity.id}, true, true, true, true)`
    const actor = { userId, roleId: adminRoleId }
    const specs = [
      { name: 'nombre', label: 'Nombre', dataType: 'text', validationRules: { trim: true, case: 'upper', default: 'sin nombre', notBlank: true } },
      { name: 'cantidad', label: 'Cantidad', dataType: 'number', validationRules: { default: 2, positive: true, maxDecimals: 0 } },
      { name: 'precio', label: 'Precio', dataType: 'number', validationRules: { default: 3 } },
      { name: 'importe', label: 'Importe', dataType: 'number', validationRules: { calculation: { kind: 'formula', operator: 'multiply', leftField: 'cantidad', rightField: 'precio' } } },
      { name: 'inicio', label: 'Inicio', dataType: 'date', validationRules: { default: 'today', minRelative: 0 } },
      { name: 'fin', label: 'Fin', dataType: 'date', validationRules: { after: 'inicio' } }
    ]
    for (const spec of specs) await withRecordActor(actor, () => createEntityField(tenantId, entity.id, { ...spec, isRequired: false }))
    const event = (body: unknown, id?: string) => ({ context: { auth: { tenantId, roleId: adminRoleId, sub: userId }, params: { entity: 'defaults152', id }, body } })
    const created = await withRecordActor(actor, () => createRecord(event({ customData: {} })))
    expect(created.customData).toMatchObject({ nombre: 'SIN NOMBRE', cantidad: 2, precio: 3, importe: 6 })
    const [organization] = await admin`select timezone from tenants where id = ${tenantId}`
    expect(dateDay(created.customData.inicio, organization.timezone)).toBe(dateDay(new Date(), organization.timezone))
    const explicit = await withRecordActor(actor, () => createRecord(event({ customData: { nombre: '  ána ', cantidad: 4, precio: null, inicio: null } })))
    expect(explicit.customData).toMatchObject({ nombre: 'ÁNA', cantidad: 4, precio: null })
    const put = (await import('../../server/api/records/[entity]/[id].put')).default
    const patch = (await import('../../server/api/records/[entity]/[id].patch')).default
    const updated = await withRecordActor(actor, () => put(event({ customData: { nombre: '  cambio ', cantidad: 5, precio: 3, inicio: created.customData.inicio } }, created.id) as never))
    expect(updated.customData).toMatchObject({ nombre: 'CAMBIO', cantidad: 5, importe: 15 })
    await expect(withRecordActor(actor, () => put(event({ customData: { nombre: '   ' } }, created.id) as never))).rejects.toMatchObject({ statusCode: 422 })
    await expect(withRecordActor(actor, () => patch(event({ changes: { fin: created.customData.inicio } }, created.id) as never))).rejects.toMatchObject({ statusCode: 422 })
    const omitted = await withRecordActor(actor, () => put(event({ customData: { cantidad: 1, precio: 2 } }, created.id) as never))
    expect((omitted.customData as Record<string, unknown>).nombre).toBeUndefined()
  })
})
