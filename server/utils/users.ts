import { randomBytes, createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { roles, tenants, users } from '~/server/db/schema'
import { hashPassword } from '~/server/utils/auth'
import { sendInvitationEmail } from '~/server/utils/mailer'

// HU-ERD-84: logica de gestion de usuarios (listar, invitar, editar rol/estado,
// reenviar/cancelar invitacion, aceptar invitacion) - separada de los
// endpoints, mismo patron que rolePermissions.ts/moduleEntities.ts.

type Tx = typeof db

// Postgres SQLSTATE - mismo criterio que moduleEntities.ts/rolePermissions.ts.
const PG_UNIQUE_VIOLATION = '23505'

export class DuplicateEmailError extends Error {}
export class RoleNotFoundError extends Error {}
export class TargetUserNotFoundError extends Error {}
export class CannotEditSelfError extends Error {}
export class InvitationNotPendingError extends Error {}
export class InvalidInvitationTokenError extends Error {}
export class InvitationExpiredError extends Error {}

// 7 dias - copy exacto del correo real ("Este enlace expira en 7 días",
// Email/Invitación Usuario en el .pen, nodo mEHkf).
const INVITATION_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000

export type UserStatus = 'activo' | 'inactivo' | 'invitacion_pendiente'

export interface UserSummary {
  id: string
  email: string
  fullName: string | null
  roleId: string | null
  roleName: string | null
  isActive: boolean
  status: UserStatus
  createdAt: Date
}

function resolveStatus(row: { isActive: boolean; invitationTokenHash: string | null; invitationExpiresAt: Date | null }): UserStatus {
  if (row.invitationTokenHash && row.invitationExpiresAt && row.invitationExpiresAt.getTime() > Date.now()) {
    return 'invitacion_pendiente'
  }
  return row.isActive ? 'activo' : 'inactivo'
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El token de invitacion codifica el tenantId como prefijo
 * (`<tenantId>.<secreto-aleatorio>`) - a proposito, para que
 * acceptInvitation() pueda resolver el tenant y usar SIEMPRE withTenant()
 * (RLS real) sin necesitar una consulta cross-tenant sin RLS. Conocer el
 * tenantId no ayuda a adivinar el secreto (32 bytes aleatorios, HMAC del
 * secreto es lo que se guarda como hash) - mismo criterio de "el RLS de esta
 * app filtra por tenant_id, nunca hay que esquivarlo" documentado en
 * server/utils/fileStorage.ts (HU-ERD-78, assertEntityInTenant).
 */
function generateInvitationToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString('hex')}`
}

function parseInvitationToken(token: string): { tenantId: string } {
  const dotIndex = token.indexOf('.')
  const tenantId = dotIndex > 0 ? token.slice(0, dotIndex) : ''
  if (!UUID_PATTERN.test(tenantId)) {
    throw new InvalidInvitationTokenError('El enlace de invitación no es válido')
  }
  return { tenantId }
}

/**
 * Lista los usuarios del tenant (Screen/Usuarios: columnas Usuario/Rol/Estado/
 * Acciones), con el nombre del rol resuelto (roleId puede ser null - "sin rol
 * asignado" - o apuntar a un rol ya borrado via onDelete: 'set null').
 */
export async function listUsers(tenantId: string): Promise<UserSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        roleId: users.roleId,
        roleName: roles.name,
        isActive: users.isActive,
        invitationTokenHash: users.invitationTokenHash,
        invitationExpiresAt: users.invitationExpiresAt,
        createdAt: users.createdAt
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.tenantId, tenantId))
      .orderBy(users.createdAt)

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      roleId: row.roleId,
      roleName: row.roleName,
      isActive: row.isActive,
      status: resolveStatus(row),
      createdAt: row.createdAt
    }))
  })
}

async function assertRoleInTenant(tx: Tx, tenantId: string, roleId: string): Promise<{ name: string }> {
  const [role] = await tx.select({ name: roles.name }).from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))).limit(1)
  if (!role) throw new RoleNotFoundError(`El rol ${roleId} no existe en este tenant`)
  return role
}

export interface InviteUserResult {
  user: UserSummary
}

/**
 * Invita un usuario nuevo: crea la fila en `users` con isActive=false (gate
 * real que impide login, ver comentario largo en schema.ts) y un token de
 * invitacion (se guarda el HASH, se manda el crudo por correo - mismo
 * criterio que un token de reseteo de contraseña). Envia el correo real via
 * SMTP (server/utils/mailer.ts) - si el envio falla (SMTP no configurado, o
 * cualquier error del transporte), la fila NO queda creada (todo dentro de
 * la misma withTenant) para no dejar una invitacion fantasma que nadie
 * recibio y que nadie en el listado puede reenviar de forma obvia.
 *
 * inviterFullName: nombre de quien invita (Screen/Usuarios no lo pide - lo
 * resuelve el propio endpoint del admin autenticado), usado solo en el
 * cuerpo del correo ("<Nombre> te invitó a colaborar..."), copy exacto del
 * .pen.
 */
export async function inviteUser(tenantId: string, email: string, roleId: string, inviterFullName: string): Promise<InviteUserResult> {
  const normalizedEmail = email.trim().toLowerCase()
  const token = generateInvitationToken(tenantId)
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRES_IN_MS)

  const { user, tenantName, roleName } = await withTenant(tenantId, async (tx) => {
    const role = await assertRoleInTenant(tx, tenantId, roleId)

    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    const tenantName = tenant?.name ?? 'tu organización'

    // Placeholder inutilizable: passwordHash es NOT NULL en el schema y no
    // hay forma de dejarlo vacio - un hash de un valor aleatorio que nunca
    // se entrega a nadie. isActive=false ya es el gate real de login; esto
    // es solo para satisfacer la columna.
    const placeholderPassword = randomBytes(24).toString('hex')
    const placeholderHash = await hashPassword(placeholderPassword)

    let row: typeof users.$inferSelect
    try {
      ;[row] = await tx
        .insert(users)
        .values({
          tenantId,
          roleId,
          email: normalizedEmail,
          passwordHash: placeholderHash,
          isActive: false,
          invitationTokenHash: tokenHash,
          invitationExpiresAt: expiresAt
        })
        .returning()
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateEmailError(`Ya existe un usuario con el correo "${normalizedEmail}" en este tenant`)
      }
      throw err
    }

    return { user: row, tenantName, roleName: role.name }
  })

  await sendInvitationEmail({ to: normalizedEmail, tenantName, inviterName: inviterFullName, roleName, token })

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      roleName,
      isActive: user.isActive,
      status: 'invitacion_pendiente',
      createdAt: user.createdAt
    }
  }
}

/**
 * Reenvia la invitacion (boton "Reenviar" del listado, para una invitacion
 * ya vencida o que el destinatario perdio): genera un token nuevo (invalida
 * el anterior) y una expiracion nueva de 7 dias, y vuelve a mandar el
 * correo. Solo tiene sentido sobre un usuario que TODAVIA no acepto -
 * InvitationNotPendingError si ya es una cuenta activa.
 */
export async function resendInvitation(tenantId: string, userId: string, inviterFullName: string): Promise<InviteUserResult> {
  const token = generateInvitationToken(tenantId)
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRES_IN_MS)

  const { user, tenantName, roleName } = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, isActive: users.isActive, invitationTokenHash: users.invitationTokenHash, roleId: users.roleId })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1)
    if (!existing) throw new TargetUserNotFoundError(`El usuario ${userId} no existe en este tenant`)
    if (existing.isActive || !existing.invitationTokenHash) {
      throw new InvitationNotPendingError('Este usuario ya aceptó su invitación (o nunca fue invitado)')
    }

    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    const tenantName = tenant?.name ?? 'tu organización'
    const role = existing.roleId ? await assertRoleInTenant(tx, tenantId, existing.roleId) : { name: 'Sin rol' }

    const [row] = await tx
      .update(users)
      .set({ invitationTokenHash: tokenHash, invitationExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning()

    return { user: row, tenantName, roleName: role.name }
  })

  await sendInvitationEmail({ to: user.email, tenantName, inviterName: inviterFullName, roleName, token })

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      roleName,
      isActive: user.isActive,
      status: 'invitacion_pendiente',
      createdAt: user.createdAt
    }
  }
}

export interface UpdateUserInput {
  roleId?: string | null
  isActive?: boolean
}

/**
 * Edita rol y/o estado activo de un usuario ya existente (acciones de la
 * columna "Acciones" del listado). No permite tocar la propia cuenta
 * (CannotEditSelfError) - evita que un admin se quite el rol o se desactive
 * a si mismo por accidente y quede sin forma de revertirlo.
 */
export async function updateUser(tenantId: string, userId: string, actingUserId: string, input: UpdateUserInput): Promise<UserSummary> {
  if (userId === actingUserId) {
    throw new CannotEditSelfError('No puedes editar tu propio acceso desde esta pantalla')
  }

  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1)
    if (!existing) throw new TargetUserNotFoundError(`El usuario ${userId} no existe en este tenant`)

    if (input.roleId) {
      await assertRoleInTenant(tx, tenantId, input.roleId)
    }

    const [row] = await tx
      .update(users)
      .set({
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning()

    const roleName = row.roleId ? (await assertRoleInTenant(tx, tenantId, row.roleId)).name : null

    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      roleId: row.roleId,
      roleName,
      isActive: row.isActive,
      status: resolveStatus(row),
      createdAt: row.createdAt
    }
  })
}

/**
 * Cancela una invitacion todavia pendiente (borra la fila entera - un
 * usuario invitado que nunca acepto no tiene ningun dato propio mas alla del
 * correo/rol elegidos al invitar). InvitationNotPendingError si la cuenta ya
 * esta activa - cancelar una cuenta activa no es "cancelar invitacion", es
 * desactivar (updateUser con isActive:false), una accion distinta a
 * proposito.
 */
export async function cancelInvitation(tenantId: string, userId: string, actingUserId: string): Promise<void> {
  if (userId === actingUserId) {
    throw new CannotEditSelfError('No puedes editar tu propio acceso desde esta pantalla')
  }

  await withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, isActive: users.isActive, invitationTokenHash: users.invitationTokenHash })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1)
    if (!existing) throw new TargetUserNotFoundError(`El usuario ${userId} no existe en este tenant`)
    if (existing.isActive || !existing.invitationTokenHash) {
      throw new InvitationNotPendingError('Este usuario ya aceptó su invitación - no se puede cancelar, solo desactivar')
    }
    await tx.delete(users).where(eq(users.id, userId))
  })
}

/**
 * Acepta una invitacion (pages/invitacion/[token].vue - PUBLICO, no requiere
 * sesion): el tenantId viene codificado en el propio token
 * (generateInvitationToken) - se resuelve ahi y TODO lo demas pasa por
 * withTenant() con ese tenant, nunca una consulta cross-tenant sin RLS (ver
 * comentario largo de generateInvitationToken). Valida el token contra el
 * HASH guardado (nunca contra el crudo - mismo criterio que passwordHash) y
 * su expiracion, fija la contrasena real (ya validada contra
 * passwordPolicySchema en el endpoint) y activa la cuenta.
 */
export async function acceptInvitation(token: string, newPassword: string, fullName?: string): Promise<{ tenantId: string }> {
  const { tenantId } = parseInvitationToken(token)
  const tokenHash = hashToken(token)
  const passwordHash = await hashPassword(newPassword)

  await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: users.id, invitationExpiresAt: users.invitationExpiresAt })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.invitationTokenHash, tokenHash)))
      .limit(1)

    if (!row) {
      throw new InvalidInvitationTokenError('El enlace de invitación no es válido')
    }
    if (!row.invitationExpiresAt || row.invitationExpiresAt.getTime() < Date.now()) {
      throw new InvitationExpiredError('El enlace de invitación expiró - pide que te reenvíen la invitación')
    }

    await tx
      .update(users)
      .set({
        passwordHash,
        isActive: true,
        invitationTokenHash: null,
        invitationExpiresAt: null,
        ...(fullName ? { fullName: fullName.trim() } : {}),
        updatedAt: new Date()
      })
      .where(eq(users.id, row.id))
  })

  return { tenantId }
}
