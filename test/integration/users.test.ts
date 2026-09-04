import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  listUsers as ListUsers,
  inviteUser as InviteUser,
  resendInvitation as ResendInvitation,
  updateUser as UpdateUser,
  cancelInvitation as CancelInvitation,
  acceptInvitation as AcceptInvitation,
  DuplicateEmailError as DuplicateEmailErrorType,
  RoleNotFoundError as RoleNotFoundErrorType,
  TargetUserNotFoundError as TargetUserNotFoundErrorType,
  CannotEditSelfError as CannotEditSelfErrorType,
  InvitationNotPendingError as InvitationNotPendingErrorType,
  InvalidInvitationTokenError as InvalidInvitationTokenErrorType,
  InvitationExpiredError as InvitationExpiredErrorType
} from '../../server/utils/users'

// HU-ERD-84: prueba server/utils/users.ts contra un Postgres real (mismo
// criterio que changePassword.test.ts/moduleEntities.test.ts, HU-ERD-29/66) -
// primera pieza de logica que ESCRIBE users.invitation_token_hash/
// invitation_expires_at, ademas de confirmar el aislamiento por tenant (RLS)
// del token de invitacion (parseInvitationToken + withTenant, ver comentario
// largo en server/utils/users.ts) y el gate isActive=false hasta aceptar.
//
// nodemailer se mockea (sendMail capturado en memoria) - este test NO manda
// correos reales ni depende de un SMTP disponible en el entorno; eso es
// responsabilidad de mailer.test.ts (unit, sin Postgres).
const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}))

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql

let listUsers: typeof ListUsers
let inviteUser: typeof InviteUser
let resendInvitation: typeof ResendInvitation
let updateUser: typeof UpdateUser
let cancelInvitation: typeof CancelInvitation
let acceptInvitation: typeof AcceptInvitation
let DuplicateEmailError: typeof DuplicateEmailErrorType
let RoleNotFoundError: typeof RoleNotFoundErrorType
let TargetUserNotFoundError: typeof TargetUserNotFoundErrorType
let CannotEditSelfError: typeof CannotEditSelfErrorType
let InvitationNotPendingError: typeof InvitationNotPendingErrorType
let InvalidInvitationTokenError: typeof InvalidInvitationTokenErrorType
let InvitationExpiredError: typeof InvitationExpiredErrorType

let roleAId: string
let roleBId: string
let adminUserId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Acme Corp')`
  const [roleA] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Ventas', false) returning id`
  roleAId = roleA.id as string
  const [sysRole] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Administrador', true) returning id`
  const [adminPerson] = await admin`
    insert into people (email, password_hash, full_name)
    values ('admin@acme.com', 'x', 'María García')
    returning id
  `
  const [adminUser] = await admin`
    insert into users (tenant_id, role_id, person_id, is_active)
    values (${TENANT_A}, ${sysRole.id}, ${adminPerson.id}, true)
    returning id
  `
  adminUserId = adminUser.id as string

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`
  const [roleB] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_B}, 'Ventas', false) returning id`
  roleBId = roleB.id as string

  process.env.APP_DATABASE_URL = testDb.appUrl
  process.env.SMTP_HOST = 'smtp.test.local'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_USER = 'user'
  process.env.SMTP_PASSWORD = 'pass'
  process.env.SMTP_FROM = 'ERP Dinámico <no-responder@test.local>'
  process.env.APP_BASE_URL = 'https://app.erpdinamico.test'

  ;({
    listUsers,
    inviteUser,
    resendInvitation,
    updateUser,
    cancelInvitation,
    acceptInvitation,
    DuplicateEmailError,
    RoleNotFoundError,
    TargetUserNotFoundError,
    CannotEditSelfError,
    InvitationNotPendingError,
    InvalidInvitationTokenError,
    InvitationExpiredError
  } = await import('../../server/utils/users'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

function lastInviteUrl(): string {
  const call = sendMailMock.mock.calls.at(-1)
  const html = call?.[0]?.html as string
  const match = html.match(/https:\/\/app\.erpdinamico\.test\/invitacion\/[^"<\s]+/)
  if (!match) throw new Error('No se encontró el enlace de invitación en el correo mockeado')
  return match[0]
}

describe('inviteUser (Postgres real)', () => {
  it('rechaza un rol que no existe en el tenant', async () => {
    await expect(inviteUser(TENANT_A, 'nuevo@acme.com', randomUUID(), 'María García')).rejects.toBeInstanceOf(RoleNotFoundError)
  })

  it('rechaza un rol que es de OTRO tenant (RLS)', async () => {
    await expect(inviteUser(TENANT_A, 'nuevo@acme.com', roleBId, 'María García')).rejects.toBeInstanceOf(RoleNotFoundError)
  })

  it('crea el usuario inactivo con invitación pendiente y manda el correo real', async () => {
    sendMailMock.mockClear()
    const result = await inviteUser(TENANT_A, 'Maria.Nueva@Acme.com', roleAId, 'María García')

    expect(result.user.email).toBe('maria.nueva@acme.com') // normalizado a minúsculas
    expect(result.user.isActive).toBe(false)
    expect(result.user.status).toBe('invitacion_pendiente')
    expect(result.user.roleName).toBe('Ventas')

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0]
    expect(call.to).toBe('maria.nueva@acme.com')
    expect(call.subject).toContain('Acme Corp')
    expect(call.html).toContain('Te invitaron a unirte a Acme Corp')
    expect(call.html).toContain('María García te invitó')
    expect(call.html).toContain('Ventas')
    expect(call.html).toContain('Este enlace expira en 7 días')

    // El listado ya lo muestra como pendiente.
    const list = await listUsers(TENANT_A)
    const row = list.find((u) => u.id === result.user.id)
    expect(row?.status).toBe('invitacion_pendiente')
  })

  it('rechaza un correo duplicado dentro del mismo tenant', async () => {
    await expect(inviteUser(TENANT_A, 'maria.nueva@acme.com', roleAId, 'María García')).rejects.toBeInstanceOf(DuplicateEmailError)
  })

  it('el mismo correo SÍ puede invitarse en otro tenant - misma persona, membresía nueva y activa de inmediato', async () => {
    // HU multi-organizacion (2026-09-04): la unicidad de `people.email` es
    // GLOBAL - invitar el mismo correo a otro tenant no crea una persona
    // nueva, crea una membresia nueva sobre la MISMA persona. Como ya tiene
    // contraseña propia, entra por el camino "existing" de inviteUser()
    // (activa de inmediato, sin token de invitacion).
    const result = await inviteUser(TENANT_B, 'maria.nueva@acme.com', roleBId, 'Otro Admin')
    expect(result.user.email).toBe('maria.nueva@acme.com')
    expect(result.user.isActive).toBe(true)
    expect(result.user.status).toBe('activo')
  })

  it('el usuario invitado no puede loguear todavía (isActive=false)', async () => {
    const [row] = await admin`
      select u.is_active as is_active
      from users u
      join people p on p.id = u.person_id
      where p.email = 'maria.nueva@acme.com' and u.tenant_id = ${TENANT_A}
    `
    expect(row.is_active).toBe(false)
  })
})

describe('acceptInvitation (Postgres real)', () => {
  it('acepta con el token real del correo, activa la cuenta y fija la contraseña', async () => {
    sendMailMock.mockClear()
    const { user } = await inviteUser(TENANT_A, 'invitado.aceptar@acme.com', roleAId, 'María García')
    const inviteUrl = lastInviteUrl()
    const token = inviteUrl.split('/invitacion/')[1]

    await acceptInvitation(token, 'clave-nueva-123')

    const [row] = await admin`select is_active, invitation_token_hash, invitation_expires_at from users where id = ${user.id}`
    expect(row.is_active).toBe(true)
    expect(row.invitation_token_hash).toBeNull()
    expect(row.invitation_expires_at).toBeNull()

    const list = await listUsers(TENANT_A)
    expect(list.find((u) => u.id === user.id)?.status).toBe('activo')
  })

  it('rechaza un token que no existe', async () => {
    await expect(acceptInvitation(`${TENANT_A}.token-inventado`, 'clave-nueva-123')).rejects.toBeInstanceOf(InvalidInvitationTokenError)
  })

  it('rechaza un tenantId con formato inválido en el token', async () => {
    await expect(acceptInvitation('no-es-un-uuid.abc123', 'clave-nueva-123')).rejects.toBeInstanceOf(InvalidInvitationTokenError)
  })

  it('el mismo token no puede usarse dos veces (ya se limpió tras aceptar)', async () => {
    sendMailMock.mockClear()
    const { user } = await inviteUser(TENANT_A, 'invitado.una-vez@acme.com', roleAId, 'María García')
    const token = lastInviteUrl().split('/invitacion/')[1]

    await acceptInvitation(token, 'clave-nueva-123')
    await expect(acceptInvitation(token, 'otra-clave-456')).rejects.toBeInstanceOf(InvalidInvitationTokenError)
    void user
  })

  it('rechaza un token expirado', async () => {
    sendMailMock.mockClear()
    const { user } = await inviteUser(TENANT_A, 'invitado.vencido@acme.com', roleAId, 'María García')
    const token = lastInviteUrl().split('/invitacion/')[1]

    // Fuerza la expiración directamente en la base (sin esperar 7 días).
    await admin`update users set invitation_expires_at = now() - interval '1 hour' where id = ${user.id}`

    await expect(acceptInvitation(token, 'clave-nueva-123')).rejects.toBeInstanceOf(InvitationExpiredError)
  })
})

describe('resendInvitation (Postgres real)', () => {
  it('genera un token nuevo que invalida el anterior', async () => {
    sendMailMock.mockClear()
    const { user } = await inviteUser(TENANT_A, 'invitado.reenvio@acme.com', roleAId, 'María García')
    const oldToken = lastInviteUrl().split('/invitacion/')[1]

    sendMailMock.mockClear()
    await resendInvitation(TENANT_A, user.id, 'María García')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const newToken = lastInviteUrl().split('/invitacion/')[1]

    expect(newToken).not.toBe(oldToken)
    await expect(acceptInvitation(oldToken, 'clave-x')).rejects.toBeInstanceOf(InvalidInvitationTokenError)
    await expect(acceptInvitation(newToken, 'clave-nueva-123')).resolves.toBeTruthy()
  })

  it('rechaza reenviar sobre una cuenta ya activa', async () => {
    await expect(resendInvitation(TENANT_A, adminUserId, 'María García')).rejects.toBeInstanceOf(InvitationNotPendingError)
  })

  it('rechaza un usuario que no existe en el tenant', async () => {
    await expect(resendInvitation(TENANT_A, randomUUID(), 'María García')).rejects.toBeInstanceOf(TargetUserNotFoundError)
  })
})

describe('updateUser (Postgres real)', () => {
  it('cambia el rol y el estado activo', async () => {
    sendMailMock.mockClear()
    const { user } = await inviteUser(TENANT_A, 'invitado.editar@acme.com', roleAId, 'María García')
    const token = lastInviteUrl().split('/invitacion/')[1]
    await acceptInvitation(token, 'clave-nueva-123')

    const updated = await updateUser(TENANT_A, user.id, adminUserId, { isActive: false })
    expect(updated.isActive).toBe(false)
    expect(updated.status).toBe('inactivo')
  })

  it('no permite editar la propia cuenta', async () => {
    await expect(updateUser(TENANT_A, adminUserId, adminUserId, { isActive: false })).rejects.toBeInstanceOf(CannotEditSelfError)
  })

  it('rechaza un roleId de otro tenant', async () => {
    await expect(updateUser(TENANT_A, adminUserId, randomUUID(), { roleId: roleBId })).rejects.toBeInstanceOf(RoleNotFoundError)
  })
})

describe('cancelInvitation (Postgres real)', () => {
  it('borra un usuario todavía invitado (sin aceptar)', async () => {
    sendMailMock.mockClear()
    const { user } = await inviteUser(TENANT_A, 'invitado.cancelar@acme.com', roleAId, 'María García')

    await cancelInvitation(TENANT_A, user.id, adminUserId)

    const list = await listUsers(TENANT_A)
    expect(list.find((u) => u.id === user.id)).toBeUndefined()
  })

  it('rechaza cancelar una cuenta ya activa', async () => {
    await expect(cancelInvitation(TENANT_A, adminUserId, randomUUID())).rejects.toBeInstanceOf(InvitationNotPendingError)
  })

  it('no permite cancelar la propia cuenta', async () => {
    await expect(cancelInvitation(TENANT_A, adminUserId, adminUserId)).rejects.toBeInstanceOf(CannotEditSelfError)
  })
})
