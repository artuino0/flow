import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { sql } from 'drizzle-orm'

let testDb: TestDb
let admin: postgres.Sql
let apply: typeof import('../../server/utils/blueprint/apply').applyBlueprint
let undo: typeof import('../../server/utils/blueprint/undo').undoBlueprintApplication
let list: typeof import('../../server/utils/blueprint/undo').listBlueprintApplications
let template: Record<string, unknown>
let adminRoleId: string
let readerRoleId: string
let userId: string

async function tenant(label: string) {
  const id = randomUUID()
  await admin`insert into tenants (id, name, slug) values (${id}, ${label}, ${`undo-${id}`})`
  await admin`insert into roles (tenant_id, name, is_system) values (${id}, 'Administrador', true)`
  return id
}

async function applicationId(tenantId: string, key: string) {
  const [row] = await admin`select id from blueprint_applications where tenant_id = ${tenantId} and idempotency_key = ${key}`
  return row.id as string
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.APP_DATABASE_URL = testDb.appUrl
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<unknown>) => handler)
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event.context.params?.[name])
  vi.stubGlobal('readBody', async (event: any) => event.context.body)
  ;({ applyBlueprint: apply } = await import('../../server/utils/blueprint/apply'))
  ;({ undoBlueprintApplication: undo, listBlueprintApplications: list } = await import('../../server/utils/blueprint/undo'))
  template = JSON.parse(await readFile(new URL('../../data/blueprints/taller-mecanico.json', import.meta.url), 'utf8'))
  const id = await tenant('API')
  const [adminRole] = await admin`select id from roles where tenant_id = ${id}`
  adminRoleId = adminRole.id
  const [reader] = await admin`insert into roles (tenant_id, name, is_system) values (${id}, 'Lector', false) returning id`
  readerRoleId = reader.id
  const [person] = await admin`insert into people (email, password_hash, full_name) values ('undo@test.local', 'x', 'Undo Tester') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${id}, ${adminRoleId}, ${person.id}) returning id`
  userId = user.id
  apiTenant = id
}, 60_000)

let apiTenant: string
afterAll(async () => { await admin.end(); await testDb.stop() })

describe('deshacer planos (Postgres real y RLS)', () => {
  it('aplica y revierte roles y visibilidad propuestos junto con un campo responsable', async () => {
    const id = await tenant('Roles de plano')
    const plan = {
      version: 1, summary: 'Citas por doctor',
      modules: [{ ref: 'citas', action: 'create', kind: 'hecho', name: 'Citas', slug: 'citas', fields: [
        { name: 'doctor', label: 'Doctor', dataType: 'user', isOwnerField: true, validationRules: { roles: ['Doctor'] } }
      ] }], associations: [], roles: [
        { name: 'Doctor', permissions: [{ moduleRef: 'citas', visibility: 'own', canRead: true, canCreate: true, canUpdate: true, canDelete: false }] },
        { name: 'Recepción', permissions: [{ moduleRef: 'citas', visibility: 'all', canRead: true, canCreate: true, canUpdate: true, canDelete: true }] }
      ]
    }
    const applied = await apply(id, null, plan, 'roles')
    const [field] = await admin`select is_owner_field from entity_fields where entity_id = ${applied.modules[0].id} and name = 'doctor'`
    expect(field.is_owner_field).toBe(true)
    const permissions = await admin`select r.name, p.visibility from role_entity_permissions p join roles r on r.id = p.role_id where r.tenant_id = ${id} and r.name in ('Doctor', 'Recepción') order by r.name`
    expect(permissions).toMatchObject([{ name: 'Doctor', visibility: 'own' }, { name: 'Recepción', visibility: 'all' }])
    await undo(id, await applicationId(id, 'roles'))
    expect(await admin`select id from roles where tenant_id = ${id} and name in ('Doctor', 'Recepción')`).toHaveLength(0)
  }, 60_000)

  it('deshace el taller completo en tenant vacío y deja los módulos en papelera', async () => {
    const id = await tenant('Taller reversible')
    const applied = await apply(id, null, template, 'taller')
    expect(applied.createdAssociations).toHaveLength(1)
    const application = await applicationId(id, 'taller')
    expect((await list(id))[0]).toMatchObject({ canUndo: true, modules: 6 })
    await undo(id, application)
    expect(await admin`select id from entities where tenant_id = ${id} and deleted_at is null`).toHaveLength(0)
    expect(await admin`select id from relation_definitions where tenant_id = ${id}`).toHaveLength(0)
    expect(await admin`select f.id from entity_fields f join entities e on e.id = f.entity_id where e.tenant_id = ${id} and e.deleted_at is null`).toHaveLength(0)
    expect(await admin`select undone_at from blueprint_applications where id = ${application}`).toMatchObject([{ undone_at: expect.any(Date) }])
    await expect(undo(id, application)).rejects.toMatchObject({ statusCode: 409 })
  }, 60_000)

  it('bloquea registros activos en módulo creado, informa cantidad y no modifica nada', async () => {
    const id = await tenant('Con registros')
    const applied = await apply(id, null, template, 'con-registros')
    const application = await applicationId(id, 'con-registros')
    const clientes = applied.modules.find(module => module.slug === 'clientes')!
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${id}, ${clientes.id}, ${admin.json({ nombre: 'Ana' })})`
    // 0091 oculta los datos al actor ausente: esta era la cuenta de HEAD.
    const { withTenant } = await import('../../server/db')
    await withRecordActor({ userId: null, roleId: null }, async () => {
      const invisible = await withTenant(id, tx => tx.execute(sql`select count(*)::int as count from records where tenant_id = ${id}::uuid and entity_id = ${clientes.id}::uuid and deleted_at is null`))
      expect(invisible[0]?.count).toBe(0)
      expect((await list(id))[0]).toMatchObject({ canUndo: false, reason: expect.stringContaining('Clientes: 1 registros') })
    })
    await expect(undo(id, application)).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('Clientes: 1 registros') })
    expect(await admin`select id from entities where tenant_id = ${id} and deleted_at is null`).toHaveLength(6)
    expect(await admin`select undone_at from blueprint_applications where id = ${application}`).toMatchObject([{ undone_at: null }])
  }, 60_000)

  it('cuenta todos los planos sin actor y restaura el modo sistema antes de escribir', async () => {
    const id = await tenant('Modo sistema acotado')
    for (const slug of ['primero', 'segundo']) {
      const plan = { version: 1, summary: slug, modules: [{ ref: slug, action: 'create', kind: 'hecho', name: slug, slug, fields: [] }], associations: [] }
      const applied = await apply(id, null, plan, slug)
      await admin`insert into records (tenant_id, entity_id, custom_data) values (${id}, ${applied.modules[0].id}, '{}'::jsonb)`
    }
    await withRecordActor({ userId: null, roleId: null }, async () => {
      const listing = await list(id)
      expect(listing).toHaveLength(2)
      for (const row of listing) expect(row).toMatchObject({ canUndo: false, reason: expect.stringContaining('1 registros') })
      await admin`update records set deleted_at = now() where tenant_id = ${id}`
      // La escritura real de auditoría falla si assess deja elevado el GUC.
      await admin.unsafe(`create function undo_test_system_scope() returns trigger language plpgsql as $$ begin if new.tenant_id = '${id}'::uuid and current_setting('app.record_system', true) <> 'off' then raise exception 'modo sistema fuera del conteo'; end if; return new; end $$`)
      await admin.unsafe('create trigger undo_test_system_scope_trigger before update on blueprint_applications for each row execute function undo_test_system_scope()')
      try {
        for (const row of listing) await undo(id, row.id)
      } finally {
        await admin.unsafe('drop trigger undo_test_system_scope_trigger on blueprint_applications; drop function undo_test_system_scope()')
      }
      const { withTenant } = await import('../../server/db')
      const mode = await withTenant(id, tx => tx.execute(sql`select current_setting('app.record_system', true) as mode`))
      expect(mode[0]?.mode).toBe('off')
    })
  }, 60_000)

  it('restaura exactamente la ficha y estados de módulo existente y elimina campos nuevos', async () => {
    const id = await tenant('Ampliación')
    const previousLayout = { properties: [{ name: 'nombre', visible: true }], relations: [], showActivity: true }
    const [parent] = await admin`insert into entities (tenant_id, name, slug, module_kind, detail_layout) values (${id}, 'Productos', 'productos', 'hecho', ${admin.json(previousLayout)}) returning id`
    const [child] = await admin`insert into entities (tenant_id, name, slug, module_kind) values (${id}, 'Partidas', 'partidas', 'hecho') returning id`
    await admin`insert into entity_fields (entity_id, name, label, data_type) values (${parent.id}, 'nombre', 'Nombre', 'text'), (${parent.id}, 'estado', 'Estado', 'select')`
    await admin`update entity_fields set validation_rules = ${admin.json({ options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'listo', label: 'Listo' }] })} where entity_id = ${parent.id} and name = 'estado'`
    await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${child.id}, 'producto', 'Producto', 'relation', ${admin.json({ relationEntity: 'productos' })}), (${child.id}, 'importe', 'Importe', 'number', '{}'::jsonb)`
    const plan = { version: 1, summary: 'Amplía productos', modules: [
      { ref: 'productos', action: 'extend', kind: 'hecho', name: 'Productos', slug: 'productos', fields: [{ name: 'precio_base', label: 'Precio base', dataType: 'number' }], lines: [{ childRef: 'partidas', relationField: 'producto', totals: ['importe'] }], workflow: { enabled: true, field: 'estado', initial: 'nuevo', states: { nuevo: { locked: false, editableFields: [] }, listo: { locked: true, editableFields: [] } }, transitions: [{ from: 'nuevo', to: 'listo', roles: 'all' }], rules: [] } },
      { ref: 'partidas', action: 'extend', kind: 'hecho', name: 'Partidas', slug: 'partidas', fields: [] }
    ], associations: [] }
    const applied = await apply(id, null, plan, 'ampliacion')
    expect(applied.before).toMatchObject([{ entityId: parent.id, detailLayout: previousLayout, workflowConfig: null }])
    expect(applied.fields).toContainEqual({ entityId: parent.id, name: 'precio_base' })
    const application = await applicationId(id, 'ampliacion')
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${id}, ${parent.id}, ${admin.json({ nombre: 'A', precio_base: 25 })})`
    expect(await admin`select custom_data from records where tenant_id = ${id}`).toMatchObject([{ custom_data: { nombre: 'A', precio_base: 25 } }])
    expect(await admin`select custom_data ->> 'precio_base' as value from records where tenant_id = ${id}`).toMatchObject([{ value: '25' }])
    expect((await list(id))[0].reason).toContain('Productos.precio_base')
    await expect(undo(id, application)).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('Productos.precio_base: 1 valores') })
    await admin`update records set custom_data = ${admin.json({ nombre: 'A' })} where tenant_id = ${id}`
    await undo(id, application)
    expect(await admin`select detail_layout, workflow_config from entities where id = ${parent.id}`).toMatchObject([{ detail_layout: previousLayout, workflow_config: null }])
    expect(await admin`select name from entity_fields where entity_id = ${parent.id} and name = 'precio_base'`).toHaveLength(0)
  }, 60_000)

  it('impide deshacer una aplicación anterior mientras siga una posterior relacionada', async () => {
    const id = await tenant('Dependencias')
    const first = { version: 1, summary: 'Primero', modules: [{ ref: 'uno', action: 'create', kind: 'hecho', name: 'Uno', slug: 'uno', fields: [] }], associations: [] }
    await apply(id, null, first, 'primero')
    const second = { version: 1, summary: 'Después', modules: [{ ref: 'uno', action: 'extend', kind: 'hecho', name: 'Uno', slug: 'uno', fields: [{ name: 'dato', label: 'Dato', dataType: 'text' }] }], associations: [] }
    await apply(id, null, second, 'despues')
    const oldId = await applicationId(id, 'primero')
    const newId = await applicationId(id, 'despues')
    await expect(undo(id, oldId)).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('Después') })
    await undo(id, newId)
    await undo(id, oldId)
  }, 60_000)

  it('exige confirmación explícita para diseño anterior sin instantánea y conserva la ficha', async () => {
    const id = await tenant('Legado')
    const [parent] = await admin`insert into entities (tenant_id, name, slug, module_kind) values (${id}, 'Ordenes', 'ordenes', 'hecho') returning id`
    const [child] = await admin`insert into entities (tenant_id, name, slug, module_kind) values (${id}, 'Lineas', 'lineas', 'hecho') returning id`
    await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${child.id}, 'orden', 'Orden', 'relation', ${admin.json({ relationEntity: 'ordenes' })})`
    const plan = { version: 1, summary: 'Legado', modules: [{ ref: 'ordenes', action: 'extend', kind: 'hecho', name: 'Ordenes', slug: 'ordenes', fields: [], lines: [{ childRef: 'lineas', relationField: 'orden' }] }, { ref: 'lineas', action: 'extend', kind: 'hecho', name: 'Lineas', slug: 'lineas', fields: [] }], associations: [] }
    await apply(id, null, plan, 'legado')
    const application = await applicationId(id, 'legado')
    await admin`update blueprint_applications set result = result - 'before' where id = ${application}`
    expect((await list(id))[0].warnings[0]).toContain('No se puede restaurar el diseño de ficha de Ordenes')
    await expect(undo(id, application)).rejects.toMatchObject({ statusCode: 409, data: { requiresConfirmation: true } })
    const [before] = await admin`select detail_layout from entities where id = ${parent.id}`
    await undo(id, application, null, true)
    expect(await admin`select detail_layout from entities where id = ${parent.id}`).toMatchObject([{ detail_layout: before.detail_layout }])
  }, 60_000)

  it('revierte toda la transacción si falla al marcar la auditoría deshecha', async () => {
    const id = await tenant('Rollback undo')
    await apply(id, null, template, 'rollback')
    const application = await applicationId(id, 'rollback')
    await admin.unsafe(`create function undo_test_fail() returns trigger language plpgsql as $$ begin if new.id = '${application}'::uuid and new.undone_at is not null then raise exception 'fallo forzado'; end if; return new; end $$`)
    await admin.unsafe('create trigger undo_test_fail_trigger before update on blueprint_applications for each row execute function undo_test_fail()')
    await expect(undo(id, application)).rejects.toThrow()
    await admin.unsafe('drop trigger undo_test_fail_trigger on blueprint_applications; drop function undo_test_fail()')
    expect(await admin`select id from entities where tenant_id = ${id} and deleted_at is null`).toHaveLength(6)
    expect(await admin`select id from relation_definitions where tenant_id = ${id}`).toHaveLength(1)
    expect(await admin`select undone_at from blueprint_applications where id = ${application}`).toMatchObject([{ undone_at: null }])
  }, 60_000)

  it('protege API por rol y tenant, y lista usuario y resumen', async () => {
    const plan = { version: 1, summary: 'Diseño API', modules: [], associations: [] }
    await apply(apiTenant, userId, plan, 'api')
    const application = await applicationId(apiTenant, 'api')
    const listApi = (await import('../../server/api/module-designer/applications/index.get')).default
    const undoApi = (await import('../../server/api/module-designer/applications/[id]/undo.post')).default
    const event = (tenantId: string, roleId: string) => ({ context: { auth: { tenantId, roleId, sub: userId }, params: { id: application }, body: {} } })
    await expect(listApi(event(apiTenant, readerRoleId) as never)).rejects.toMatchObject({ statusCode: 403 })
    await expect(undoApi(event(apiTenant, readerRoleId) as never)).rejects.toMatchObject({ statusCode: 403 })
    const listing = await listApi(event(apiTenant, adminRoleId) as never)
    expect(listing[0]).toMatchObject({ summary: 'Diseño API', userName: 'Undo Tester' })
    const other = await tenant('Otro tenant')
    await expect(undoApi(event(other, adminRoleId) as never)).rejects.toMatchObject({ statusCode: 403 })
    const [otherRole] = await admin`select id from roles where tenant_id = ${other}`
    await expect(undoApi(event(other, otherRole.id) as never)).rejects.toMatchObject({ statusCode: 404 })
  }, 60_000)
})
