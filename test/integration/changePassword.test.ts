import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  changeUserPassword as ChangeUserPassword,
  UserNotFoundError as UserNotFoundErrorType,
  WrongCurrentPasswordError as WrongCurrentPasswordErrorType
} from '../../server/utils/changePassword'

// HU-ERD-83 (parte 1): prueba server/utils/changePassword.ts contra un
// Postgres real (embedded-postgres, misma infraestructura de HU-ERD-29) -
// primera pieza de logica que ESCRIBE en users.password_hash desde un
// endpoint self-service (hasta esta HU, users solo se creaba via
// scripts/seed*.mjs, nunca se actualizaba desde la app).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()
const ORIGINAL_PASSWORD = 'clave-original-123'

let testDb: TestDb
let admin: postgres.Sql
let changeUserPassword: typeof ChangeUserPassword
let UserNotFoundError: typeof UserNotFoundErrorType
let WrongCurrentPasswordError: typeof WrongCurrentPasswordErrorType

let userId: string
let userInOtherTenantId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  const passwordHash = await bcrypt.hash(ORIGINAL_PASSWORD, 12)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  const [roleA] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Administrador', true) returning id`
  const [user] = await admin`
    insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
    values (${TENANT_A}, ${roleA.id}, 'user@test.com', ${passwordHash}, 'Usuario Test', true)
    returning id
  `
  userId = user.id as string

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`
  const [roleB] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_B}, 'Administrador', true) returning id`
  const [userB] = await admin`
    insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
    values (${TENANT_B}, ${roleB.id}, 'otro@test.com', ${passwordHash}, 'Otro Usuario', true)
    returning id
  `
  userInOtherTenantId = userB.id as string

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ changeUserPassword, UserNotFoundError, WrongCurrentPasswordError } = await import('../../server/utils/changePassword'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('changeUserPassword (Postgres real)', () => {
  it('rechaza si la contraseña actual no coincide, sin tocar el hash guardado', async () => {
    await expect(changeUserPassword(TENANT_A, userId, 'contraseña-incorrecta', 'nueva-clave-456')).rejects.toBeInstanceOf(WrongCurrentPasswordError)

    const [row] = await admin`select password_hash from users where id = ${userId}`
    expect(await bcrypt.compare(ORIGINAL_PASSWORD, row.password_hash)).toBe(true)
  })

  it('rechaza un userId que no existe en ese tenant (incluye uno real de OTRO tenant)', async () => {
    await expect(changeUserPassword(TENANT_A, randomUUID(), ORIGINAL_PASSWORD, 'nueva-clave-456')).rejects.toBeInstanceOf(UserNotFoundError)
    await expect(changeUserPassword(TENANT_A, userInOtherTenantId, ORIGINAL_PASSWORD, 'nueva-clave-456')).rejects.toBeInstanceOf(UserNotFoundError)
  })

  it('con la contraseña actual correcta, actualiza el hash y la nueva contraseña queda vigente', async () => {
    await changeUserPassword(TENANT_A, userId, ORIGINAL_PASSWORD, 'nueva-clave-456')

    const [row] = await admin`select password_hash from users where id = ${userId}`
    expect(await bcrypt.compare('nueva-clave-456', row.password_hash)).toBe(true)
    expect(await bcrypt.compare(ORIGINAL_PASSWORD, row.password_hash)).toBe(false)

    // La contraseña vieja ya no sirve para un segundo cambio.
    await expect(changeUserPassword(TENANT_A, userId, ORIGINAL_PASSWORD, 'otra-clave-789')).rejects.toBeInstanceOf(WrongCurrentPasswordError)
  })
})
