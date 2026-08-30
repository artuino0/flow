import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  listRoles as ListRoles,
  getRolePermissions as GetRolePermissions,
  setRolePermissions as SetRolePermissions
} from '../../server/utils/rolePermissions'

// HU-ERD-33: prueba server/utils/rolePermissions.ts contra un Postgres real
// (embedded-postgres, misma infraestructura de HU-ERD-29) - en particular que
// setRolePermissions() lea el estado recien guardado DENTRO de la misma
// transaccion (ver comentario en loadRolePermissions()) y que nunca deje
// guardar un entityId de otro tenant.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let listRoles: typeof ListRoles
let getRolePermissions: typeof GetRolePermissions
let setRolePermissions: typeof SetRolePermissions

let roleA: string
let clientesEntityA: string
let empresasEntityA: string
let entityB: string

async function seedTenant(tenantId: string, roleName: string) {
  await admin`insert into tenants (id, name) values (${tenantId}, 'Tenant ' || ${tenantId})`
  const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, ${roleName}, false) returning id`
  const [clientes] = await admin`insert into entities (tenant_id, name, slug) values (${tenantId}, 'Clientes', 'clientes') returning id`
  const [empresas] = await admin`insert into entities (tenant_id, name, slug) values (${tenantId}, 'Empresas', 'empresas') returning id`
  return { roleId: role.id as string, clientesId: clientes.id as string, empresasId: empresas.id as string }
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  const a = await seedTenant(TENANT_A, 'Vendedor')
  roleA = a.roleId
  clientesEntityA = a.clientesId
  empresasEntityA = a.empresasId

  const b = await seedTenant(TENANT_B, 'Otro rol')
  entityB = b.clientesId

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ listRoles, getRolePermissions, setRolePermissions } = await import('../../server/utils/rolePermissions'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('rolePermissions (Postgres real)', () => {
  it('listRoles devuelve los roles del tenant', async () => {
    const roles = await listRoles(TENANT_A)
    expect(roles).toHaveLength(1)
    expect(roles[0].id).toBe(roleA)
    expect(roles[0].name).toBe('Vendedor')
  })

  it('getRolePermissions devuelve false por defecto para entidades sin fila en role_entity_permissions', async () => {
    const result = await getRolePermissions(TENANT_A, roleA)
    expect(result).not.toBeNull()
    expect(result!.role.id).toBe(roleA)
    expect(result!.permissions).toHaveLength(2)
    for (const p of result!.permissions) {
      expect(p.canRead).toBe(false)
      expect(p.canCreate).toBe(false)
      expect(p.canUpdate).toBe(false)
      expect(p.canDelete).toBe(false)
    }
  })

  it('getRolePermissions devuelve null si el rol no existe o es de otro tenant', async () => {
    expect(await getRolePermissions(TENANT_A, randomUUID())).toBeNull()
    // roleA es de TENANT_A - pedirlo como TENANT_B tiene que dar null, no los
    // permisos reales (aislamiento por tenant, no solo por id de rol).
    expect(await getRolePermissions(TENANT_B, roleA)).toBeNull()
  })

  it('setRolePermissions guarda y el resultado devuelto ya refleja lo guardado (misma transaccion)', async () => {
    const result = await setRolePermissions(TENANT_A, roleA, [
      { entityId: clientesEntityA, canRead: true, canCreate: true, canUpdate: false, canDelete: false }
    ])
    expect(result).not.toBeNull()
    const clientesRow = result!.permissions.find((p) => p.entityId === clientesEntityA)
    expect(clientesRow).toMatchObject({ canRead: true, canCreate: true, canUpdate: false, canDelete: false })
    // Empresas no vino en el update - queda en su default (false), no se toca.
    const empresasRow = result!.permissions.find((p) => p.entityId === empresasEntityA)
    expect(empresasRow).toMatchObject({ canRead: false, canCreate: false, canUpdate: false, canDelete: false })

    // Confirma que quedo persistido de verdad (no solo en el valor devuelto),
    // leyendolo de nuevo desde una llamada/transaccion completamente distinta.
    const reread = await getRolePermissions(TENANT_A, roleA)
    expect(reread!.permissions.find((p) => p.entityId === clientesEntityA)).toMatchObject({ canRead: true, canCreate: true })
  })

  it('setRolePermissions es un upsert - una segunda llamada actualiza en vez de duplicar', async () => {
    await setRolePermissions(TENANT_A, roleA, [
      { entityId: clientesEntityA, canRead: true, canCreate: false, canUpdate: true, canDelete: true }
    ])
    const result = await getRolePermissions(TENANT_A, roleA)
    expect(result!.permissions.find((p) => p.entityId === clientesEntityA)).toMatchObject({
      canRead: true,
      canCreate: false,
      canUpdate: true,
      canDelete: true
    })
  })

  it('setRolePermissions rechaza (null, no guarda nada) si algun entityId es de otro tenant', async () => {
    const before = await getRolePermissions(TENANT_A, roleA)

    const result = await setRolePermissions(TENANT_A, roleA, [
      { entityId: clientesEntityA, canRead: false, canCreate: false, canUpdate: false, canDelete: false },
      { entityId: entityB, canRead: true, canCreate: true, canUpdate: true, canDelete: true }
    ])
    expect(result).toBeNull()

    // Nada se guardo - ni siquiera el entityId valido del mismo tenant (todo
    // o nada, no un guardado parcial silencioso).
    const after = await getRolePermissions(TENANT_A, roleA)
    expect(after!.permissions.find((p) => p.entityId === clientesEntityA)).toMatchObject(
      before!.permissions.find((p) => p.entityId === clientesEntityA)!
    )
  })

  it('setRolePermissions devuelve null si el rol no es del tenant', async () => {
    const result = await setRolePermissions(TENANT_B, roleA, [
      { entityId: clientesEntityA, canRead: true, canCreate: true, canUpdate: true, canDelete: true }
    ])
    expect(result).toBeNull()
  })
})
