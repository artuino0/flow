import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  createEntity as CreateEntity,
  updateEntity as UpdateEntity,
  deleteEntity as DeleteEntity,
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
  ;({ createEntity, updateEntity, deleteEntity, DuplicateSlugError } = await import('../../server/utils/moduleEntities'))
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
})
