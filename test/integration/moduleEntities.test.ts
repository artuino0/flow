import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  createEntity as CreateEntity,
  updateEntity as UpdateEntity,
  deleteEntity as DeleteEntity,
  listEntities as ListEntities,
  listVisibleEntities as ListVisibleEntities,
  DuplicateSlugError as DuplicateSlugErrorType
} from '../../server/utils/moduleEntities'

// HU-ERD-66: prueba server/utils/moduleEntities.ts contra un Postgres real
// (embedded-postgres, misma infraestructura de HU-ERD-29) - en particular el
// auto-grant al rol Administrador al crear un modulo, y que DELETE nunca
// borre datos del usuario (bloqueado si hay records).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let createEntity: typeof CreateEntity
let updateEntity: typeof UpdateEntity
let deleteEntity: typeof DeleteEntity
let listEntities: typeof ListEntities
let listVisibleEntities: typeof ListVisibleEntities
let DuplicateSlugError: typeof DuplicateSlugErrorType

let adminRoleA: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  const [roleA] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Administrador', true) returning id`
  adminRoleA = roleA.id as string

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`
  await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_B}, 'Administrador', true)`

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ createEntity, updateEntity, deleteEntity, listEntities, listVisibleEntities, DuplicateSlugError } = await import(
    '../../server/utils/moduleEntities'
  ))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('moduleEntities (Postgres real)', () => {
  it('createEntity crea el modulo y otorga CRUD completo al rol Administrador del tenant', async () => {
    const entity = await createEntity(TENANT_A, { name: 'Clientes', slug: 'clientes', description: null })
    expect(entity.slug).toBe('clientes')

    const perms = await admin`
      select can_read, can_create, can_update, can_delete from role_entity_permissions
      where role_id = ${adminRoleA} and entity_id = ${entity.id}
    `
    expect(perms).toHaveLength(1)
    expect(perms[0]).toMatchObject({ can_read: true, can_create: true, can_update: true, can_delete: true })
  })

  it('createEntity rechaza un slug duplicado dentro del mismo tenant', async () => {
    await createEntity(TENANT_A, { name: 'Empresas', slug: 'empresas', description: null })
    await expect(createEntity(TENANT_A, { name: 'Otra vez Empresas', slug: 'empresas', description: null })).rejects.toBeInstanceOf(
      DuplicateSlugError
    )
  })

  it('createEntity permite el mismo slug en tenants distintos (unico es por tenant, no global)', async () => {
    const entity = await createEntity(TENANT_B, { name: 'Clientes', slug: 'clientes', description: null })
    expect(entity.slug).toBe('clientes')
  })

  it('updateEntity edita name/description y devuelve null si la entidad no es del tenant', async () => {
    const entity = await createEntity(TENANT_A, { name: 'Proveedores', slug: 'proveedores', description: null })

    const updated = await updateEntity(TENANT_A, entity.id, { name: 'Proveedores MX', description: 'Directorio' })
    expect(updated).toMatchObject({ name: 'Proveedores MX', description: 'Directorio' })

    // Mismo id, pero pedido desde el tenant equivocado - no debe encontrarlo.
    expect(await updateEntity(TENANT_B, entity.id, { name: 'Hackeado' })).toBeNull()
  })

  // Reportado por el usuario (2026-09-03): entities.labelField (ver
  // comentario largo en server/db/schema.ts) - null por default, se puede
  // fijar a un name de campo de texto y volver a null explicitamente.
  it('updateEntity persiste labelField y lo puede volver a null explicitamente', async () => {
    const entity = await createEntity(TENANT_A, { name: 'Productores', slug: 'productores', description: null })
    expect(entity.labelField).toBeNull()

    const withLabelField = await updateEntity(TENANT_A, entity.id, { labelField: 'nombre' })
    expect(withLabelField).toMatchObject({ labelField: 'nombre' })

    const clearedAgain = await updateEntity(TENANT_A, entity.id, { labelField: null })
    expect(clearedAgain).toMatchObject({ labelField: null })
  })

  it('deleteEntity borra un modulo sin records', async () => {
    const entity = await createEntity(TENANT_A, { name: 'Descartable', slug: 'descartable', description: null })
    const result = await deleteEntity(TENANT_A, entity.id)
    expect(result).toEqual({ status: 'deleted' })
  })

  it('deleteEntity bloquea el borrado (409 en el endpoint) si el modulo tiene records', async () => {
    const entity = await createEntity(TENANT_A, { name: 'Pedidos', slug: 'pedidos', description: null })
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entity.id}, '{}')`
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entity.id}, '{}')`

    const result = await deleteEntity(TENANT_A, entity.id)
    expect(result).toEqual({ status: 'has-records', recordCount: 2 })

    // No borro nada - sigue existiendo.
    const rows = await admin`select id from entities where id = ${entity.id}`
    expect(rows).toHaveLength(1)
  })

  it('deleteEntity devuelve "not-found" si el modulo no existe o es de otro tenant', async () => {
    expect(await deleteEntity(TENANT_A, randomUUID())).toEqual({ status: 'not-found' })
  })

  // HU-ERD-69: soporte de listado para pages/modulos/index.vue (siguiendo
  // Screen/Listado Modulos del .pen).
  it('listEntities devuelve solo los modulos del tenant, ordenados por nombre, con recordCount/fieldCount en 0 por default', async () => {
    const tenantList = randomUUID()
    await admin`insert into tenants (id, name) values (${tenantList}, 'Tenant Listado')`

    await createEntity(tenantList, { name: 'Zetas', slug: 'zetas', description: null })
    await createEntity(tenantList, { name: 'Alfas', slug: 'alfas', description: 'Con descripcion' })

    const result = await listEntities(tenantList)
    expect(result.map((e) => e.name)).toEqual(['Alfas', 'Zetas'])
    expect(result.find((e) => e.slug === 'alfas')).toMatchObject({
      name: 'Alfas',
      description: 'Con descripcion',
      recordCount: 0,
      fieldCount: 0
    })
    expect(result[0].createdAt).toBeInstanceOf(Date)
  })

  it('listEntities no devuelve modulos de otros tenants', async () => {
    const tenantX = randomUUID()
    const tenantY = randomUUID()
    await admin`insert into tenants (id, name) values (${tenantX}, 'Tenant X')`
    await admin`insert into tenants (id, name) values (${tenantY}, 'Tenant Y')`

    await createEntity(tenantX, { name: 'Solo X', slug: 'solo-x', description: null })
    await createEntity(tenantY, { name: 'Solo Y', slug: 'solo-y', description: null })

    const result = await listEntities(tenantX)
    expect(result.map((e) => e.slug)).toEqual(['solo-x'])
  })

  it('listEntities cuenta records y entity_fields reales por modulo (columnas "Registros"/"Campos" del diseno)', async () => {
    const tenantCounts = randomUUID()
    await admin`insert into tenants (id, name) values (${tenantCounts}, 'Tenant Counts')`

    const withData = await createEntity(tenantCounts, { name: 'Con Datos', slug: 'con-datos', description: null })
    const empty = await createEntity(tenantCounts, { name: 'Vacio', slug: 'vacio', description: null })

    await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantCounts}, ${withData.id}, '{}')`
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantCounts}, ${withData.id}, '{}')`
    await admin`insert into entity_fields (entity_id, name, label, data_type) values (${withData.id}, 'nombre', 'Nombre', 'text')`

    const result = await listEntities(tenantCounts)
    expect(result.find((e) => e.slug === 'con-datos')).toMatchObject({ recordCount: 2, fieldCount: 1 })
    expect(result.find((e) => e.slug === 'vacio')).toMatchObject({ recordCount: 0, fieldCount: 0 })
  })

  // ERD-43/ERD-44 (2026-09-01, pedido directo del usuario: "el menu aun no
  // renderisa las entidades") - listVisibleEntities() es la fuente real de
  // GET /api/nav/entities (components/AppNav.vue). No usa requireAdminRole -
  // filtra por role_entity_permissions.can_read del rol pedido, y por
  // isActive para roles no-admin.
  describe('listVisibleEntities', () => {
    it('devuelve solo los modulos con canRead=true del rol pedido, con el icono real', async () => {
      const tenant = randomUUID()
      await admin`insert into tenants (id, name) values (${tenant}, 'Tenant Nav')`
      const [vendedor] = await admin`insert into roles (tenant_id, name, is_system) values (${tenant}, 'Vendedor', false) returning id`

      const visible = await createEntity(tenant, { name: 'Visible', slug: 'visible', description: null, icon: 'Warehouse' })
      const oculto = await createEntity(tenant, { name: 'Oculto', slug: 'oculto', description: null })

      await admin`
        insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
        values (${vendedor.id}, ${visible.id}, true, false, true, false)
      `
      await admin`
        insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
        values (${vendedor.id}, ${oculto.id}, false, false, false, false)
      `

      const result = await listVisibleEntities(tenant, vendedor.id, 'hecho')
      expect(result).toEqual([
        { id: visible.id, slug: 'visible', name: 'Visible', icon: 'Warehouse', canRead: true, canCreate: false, canUpdate: true, canDelete: false }
      ])
    })

    it('un rol admin (isSystem=true) ve un modulo inactivo igual; un rol no-admin con canRead no lo ve', async () => {
      const tenant = randomUUID()
      await admin`insert into tenants (id, name) values (${tenant}, 'Tenant Nav Inactivo')`
      const [adminRole] = await admin`insert into roles (tenant_id, name, is_system) values (${tenant}, 'Administrador', true) returning id`
      const [vendedor] = await admin`insert into roles (tenant_id, name, is_system) values (${tenant}, 'Vendedor', false) returning id`

      const entity = await createEntity(tenant, { name: 'Inactivo', slug: 'inactivo', description: null })
      await admin`
        insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
        values (${vendedor.id}, ${entity.id}, true, false, false, false)
      `
      await updateEntity(tenant, entity.id, { isActive: false })

      expect((await listVisibleEntities(tenant, vendedor.id, 'hecho')).map((r) => r.slug)).toEqual([])
      // El admin ya tiene CRUD auto-otorgado por createEntity() - sigue viendolo.
      expect((await listVisibleEntities(tenant, adminRole.id, 'hecho')).map((r) => r.slug)).toEqual(['inactivo'])
    })

    it('devuelve [] para un rol sin ningun permiso otorgado', async () => {
      const tenant = randomUUID()
      await admin`insert into tenants (id, name) values (${tenant}, 'Tenant Nav Vacio')`
      const [vendedor] = await admin`insert into roles (tenant_id, name, is_system) values (${tenant}, 'Vendedor', false) returning id`
      await createEntity(tenant, { name: 'Sin permiso', slug: 'sin-permiso', description: null })

      expect(await listVisibleEntities(tenant, vendedor.id, 'hecho')).toEqual([])
    })
  })

  // ERD-86: modulos "hecho" (transaccionales, van al menu principal) vs
  // "dimension" (catalogos, van a Administracion > Catalogos) - ver
  // comentario largo en server/db/schema.ts.
  describe('moduleKind (ERD-86)', () => {
    it('createEntity sin moduleKind explicito queda en "hecho" (default de la columna)', async () => {
      const entity = await createEntity(TENANT_A, { name: 'Default Kind', slug: 'default-kind', description: null })
      expect(entity.moduleKind).toBe('hecho')
    })

    it('createEntity con moduleKind="dimension" lo persiste tal cual', async () => {
      const entity = await createEntity(TENANT_A, { name: 'Un Catalogo', slug: 'un-catalogo', description: null, moduleKind: 'dimension' })
      expect(entity.moduleKind).toBe('dimension')
    })

    it('updateEntity ignora un moduleKind en el input (no es editable) - keys desconocidas no rompen el parse en el endpoint, pero la funcion tampoco lo acepta en su tipo', async () => {
      const entity = await createEntity(TENANT_A, { name: 'Fijo', slug: 'fijo', description: null, moduleKind: 'dimension' })
      const updated = await updateEntity(TENANT_A, entity.id, { name: 'Fijo Renombrado' })
      expect(updated?.moduleKind).toBe('dimension')
    })

    it('listEntities(tenantId, moduleKind) filtra por tipo - pages/modulos/index.vue vs pages/catalogos/index.vue', async () => {
      const tenant = randomUUID()
      await admin`insert into tenants (id, name) values (${tenant}, 'Tenant Kinds')`

      await createEntity(tenant, { name: 'Recepciones', slug: 'recepciones-k', description: null })
      await createEntity(tenant, { name: 'Cultivos', slug: 'cultivos-k', description: null, moduleKind: 'dimension' })

      expect((await listEntities(tenant, 'hecho')).map((e) => e.slug)).toEqual(['recepciones-k'])
      expect((await listEntities(tenant, 'dimension')).map((e) => e.slug)).toEqual(['cultivos-k'])
      expect((await listEntities(tenant)).map((e) => e.slug).sort()).toEqual(['cultivos-k', 'recepciones-k'])
    })

    it('listVisibleEntities(tenantId, roleId, moduleKind) excluye los catalogos del menu principal', async () => {
      const tenant = randomUUID()
      await admin`insert into tenants (id, name) values (${tenant}, 'Tenant Nav Kinds')`
      const [vendedor] = await admin`insert into roles (tenant_id, name, is_system) values (${tenant}, 'Vendedor', false) returning id`

      const hecho = await createEntity(tenant, { name: 'Recepciones', slug: 'recepciones-nav', description: null })
      const catalogo = await createEntity(tenant, { name: 'Cultivos', slug: 'cultivos-nav', description: null, moduleKind: 'dimension' })

      await admin`
        insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
        values (${vendedor.id}, ${hecho.id}, true, true, true, true), (${vendedor.id}, ${catalogo.id}, true, true, true, true)
      `

      expect((await listVisibleEntities(tenant, vendedor.id, 'hecho')).map((r) => r.slug)).toEqual(['recepciones-nav'])
      expect((await listVisibleEntities(tenant, vendedor.id, 'dimension')).map((r) => r.slug)).toEqual(['cultivos-nav'])
    })
  })
})
