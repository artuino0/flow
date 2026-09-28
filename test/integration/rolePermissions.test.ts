import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  listRoles as ListRoles,
  getRolePermissions as GetRolePermissions,
  setRolePermissions as SetRolePermissions,
  createRole as CreateRole
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
let createRole: typeof CreateRole
// DuplicateRoleNameError es una clase (valor en runtime, no solo tipo) - se
// resuelve con el mismo import() dinamico que las funciones de arriba, ya
// que el modulo entero depende de APP_DATABASE_URL estar seteado primero.
let DuplicateRoleNameError: new (message?: string) => Error
let ReferenceRoleNotFoundError: new (message?: string) => Error

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
  ;({ listRoles, getRolePermissions, setRolePermissions, createRole, DuplicateRoleNameError, ReferenceRoleNotFoundError } = await import(
    '../../server/utils/rolePermissions'
  ))
}, 60_000)

afterAll(async () => {
  await admin?.end()
  await testDb?.stop()
})

describe('rolePermissions (Postgres real)', () => {
  it('listRoles devuelve los roles del tenant', async () => {
    const roles = await listRoles(TENANT_A)
    expect(roles).toHaveLength(1)
    expect(roles[0].id).toBe(roleA)
    expect(roles[0].name).toBe('Vendedor')
    // Sin usuarios seedeados todavia en este punto de la suite.
    expect(roles[0].userCount).toBe(0)
  })

  // Rediseno "pantalla unica" (2026-09-01, ver comentario largo en
  // pages/roles/index.vue) - userCount es el dato nuevo que consume el Role
  // Selector del diseno ("N usuarios" bajo cada rol).
  it('listRoles cuenta los usuarios de cada rol (users.role_id), sin contar los de otro tenant ni los sin rol', async () => {
    const [otherRole] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Soporte', false) returning id`
    const passwordHash = 'hash-de-prueba'

    // 2 usuarios en roleA, 1 en el rol nuevo, 1 sin rol (role_id null) - todos
    // en TENANT_A. Mas 1 usuario en TENANT_B con el MISMO nombre de rol
    // conceptual, para confirmar que no se mezcla entre tenants.
    for (const [index, assignedRole] of [roleA, roleA, otherRole.id, null].entries()) {
      const [person] = await admin`insert into people (email, password_hash) values (${`user${index}@a.test`}, ${passwordHash}) returning id`
      await admin`insert into users (tenant_id, role_id, person_id) values (${TENANT_A}, ${assignedRole}, ${person.id})`
    }

    const roles = await listRoles(TENANT_A)
    const vendedor = roles.find((r) => r.id === roleA)
    const soporte = roles.find((r) => r.id === otherRole.id)
    expect(vendedor!.userCount).toBe(2)
    expect(soporte!.userCount).toBe(1)

    // Limpieza - no debe afectar al resto de la suite (que asume 1 solo rol
    // en TENANT_A en las pruebas de mas abajo, ya escritas antes de esta).
    await admin`delete from users where tenant_id = ${TENANT_A}`
    await admin`delete from roles where id = ${otherRole.id}`
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

  it('la visibilidad por defecto es all y se puede actualizar a own', async () => {
    const before = await getRolePermissions(TENANT_A, roleA)
    expect(before!.permissions.find(p => p.entityId === clientesEntityA)?.visibility).toBe('all')
    const updated = await setRolePermissions(TENANT_A, roleA, [
      { entityId: clientesEntityA, canRead: true, canCreate: false, canUpdate: true, canDelete: false, visibility: 'own' }
    ])
    expect(updated!.permissions.find(p => p.entityId === clientesEntityA)?.visibility).toBe('own')
    expect((await getRolePermissions(TENANT_A, roleA))!.permissions.find(p => p.entityId === clientesEntityA)?.visibility).toBe('own')
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

  // Rediseno "pantalla unica" (2026-09-01) - createRole() cierra el hueco
  // funcional detectado al comparar la pantalla contra el diseno real en
  // Pencil (boton "Crear rol" del Toolbar, nodo b5saUd): antes de esto no
  // habia forma alguna de dar de alta un rol nuevo, ni en el frontend ni en
  // el backend.
  describe('createRole', () => {
    it('crea un rol sin permisos iniciales sobre ninguna entidad', async () => {
      const role = await createRole(TENANT_A, 'Contabilidad')
      expect(role.name).toBe('Contabilidad')
      expect(role.isSystem).toBe(false)
      expect(role.userCount).toBe(0)

      // Aparece en listRoles()...
      const roles = await listRoles(TENANT_A)
      expect(roles.find((r) => r.id === role.id)).toMatchObject({ name: 'Contabilidad', userCount: 0 })

      // ...y sus permisos son false por defecto para toda entidad del tenant
      // (mismo criterio que un rol viejo sin filas propias en
      // role_entity_permissions - no hace falta insertar nada al crearlo).
      const perms = await getRolePermissions(TENANT_A, role.id)
      expect(perms!.permissions.length).toBeGreaterThan(0)
      for (const p of perms!.permissions) {
        expect(p).toMatchObject({ canRead: false, canCreate: false, canUpdate: false, canDelete: false })
      }
    })

    it('rechaza un nombre de rol duplicado dentro del mismo tenant (DuplicateRoleNameError)', async () => {
      await createRole(TENANT_A, 'Marketing')
      await expect(createRole(TENANT_A, 'Marketing')).rejects.toBeInstanceOf(DuplicateRoleNameError)
    })

    it('permite el mismo nombre de rol en tenants distintos', async () => {
      const roleInA = await createRole(TENANT_A, 'Finanzas')
      const roleInB = await createRole(TENANT_B, 'Finanzas')
      expect(roleInA.id).not.toBe(roleInB.id)
    })

    // Rediseno "Nuevo Rol" (2026-09-01, "checa esto" sobre
    // Screen/Roles y Permisos - Nuevo Rol) - copyFromRoleId cierra el
    // segundo hueco encontrado en esa misma pantalla: la seccion opcional
    // "Copiar permisos de" del modal real.
    it('copyFromRoleId copia los permisos del rol de referencia y devuelve copiedPermissionCount', async () => {
      const source = await createRole(TENANT_A, 'Ventas Origen')
      await setRolePermissions(TENANT_A, source.id, [
        { entityId: clientesEntityA, canRead: true, canCreate: true, canUpdate: false, canDelete: false },
        { entityId: empresasEntityA, canRead: true, canCreate: false, canUpdate: false, canDelete: false }
      ])

      const created = await createRole(TENANT_A, 'Ventas Copia', source.id)
      expect(created.copiedPermissionCount).toBe(3)

      const perms = await getRolePermissions(TENANT_A, created.id)
      expect(perms!.permissions.find((p) => p.entityId === clientesEntityA)).toMatchObject({
        canRead: true,
        canCreate: true,
        canUpdate: false,
        canDelete: false
      })
      expect(perms!.permissions.find((p) => p.entityId === empresasEntityA)).toMatchObject({ canRead: true, canCreate: false })
    })

    it('sin copyFromRoleId (o null) el rol se crea sin permisos, con copiedPermissionCount 0', async () => {
      const role = await createRole(TENANT_A, 'Sin Copia', null)
      expect(role.copiedPermissionCount).toBe(0)
      const perms = await getRolePermissions(TENANT_A, role.id)
      for (const p of perms!.permissions) {
        expect(p).toMatchObject({ canRead: false, canCreate: false, canUpdate: false, canDelete: false })
      }
    })

    it('copyFromRoleId de un rol inexistente o de otro tenant lanza ReferenceRoleNotFoundError, sin crear el rol', async () => {
      await expect(createRole(TENANT_A, 'Nombre Nunca Usado', randomUUID())).rejects.toBeInstanceOf(ReferenceRoleNotFoundError)
      const rolesAfterBadId = await listRoles(TENANT_A)
      expect(rolesAfterBadId.find((r) => r.name === 'Nombre Nunca Usado')).toBeUndefined()

      const roleBId = (await listRoles(TENANT_B))[0].id
      await expect(createRole(TENANT_A, 'Otro Nombre Nunca Usado', roleBId)).rejects.toBeInstanceOf(ReferenceRoleNotFoundError)
      const rolesAfterOtherTenantId = await listRoles(TENANT_A)
      expect(rolesAfterOtherTenantId.find((r) => r.name === 'Otro Nombre Nunca Usado')).toBeUndefined()
    })
  })
  it('ocultar del menú conserva lectura y consultas relacionadas; se copia y no se reinicia con clientes anteriores', async () => {
    const role = await createRole(TENANT_A, 'Solo selector')
    const permission = { entityId: clientesEntityA, canRead: true, canCreate: false, canUpdate: false, canDelete: false }
    await setRolePermissions(TENANT_A, role.id, [{ ...permission, showInMenu: false }])
    await setRolePermissions(TENANT_A, role.id, [permission])
    const saved = await getRolePermissions(TENANT_A, role.id)
    expect(saved!.permissions.find(p => p.entityId === clientesEntityA)).toMatchObject({ canRead: true, showInMenu: false })
    const { getPermissionFlags } = await import('../../server/utils/rbac')
    const flags = await getPermissionFlags({ tenantId: TENANT_A, roleId: role.id } as any, clientesEntityA)
    expect(flags.canRead).toBe(true)
    const { listVisibleEntities } = await import('../../server/utils/moduleEntities')
    const { buildNavigation } = await import('../../utils/moduleNavigation')
    const readable = await listVisibleEntities(TENANT_A, role.id)
    expect(readable.map(entity => entity.id)).toContain(clientesEntityA)
    expect(buildNavigation({ groups: [] }, readable).unassigned).toEqual([])
    const copied = await createRole(TENANT_A, 'Copia selector', role.id)
    const copy = await getRolePermissions(TENANT_A, copied.id)
    expect(copy!.permissions.find(p => p.entityId === clientesEntityA)).toMatchObject({ canRead: true, showInMenu: false })
  })
})
