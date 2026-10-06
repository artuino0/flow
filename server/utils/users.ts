import { randomBytes, createHash } from 'node:crypto'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { chatParticipants, people, roles, tenants, users } from '~/server/db/schema'
import { hashPassword } from '~/server/utils/auth'
import { escapeHtml, getAppBaseUrl, buildInvitationEmailHtml } from '~/server/utils/mailer'
import { enqueueCriticalEmailInTx } from './criticalEmail'
import { encryptSetting } from './settingsCrypto'
import { publishRealtime, realtimeUserTopic } from '~/server/utils/realtime'

// HU-ERD-84: logica de gestion de usuarios (listar, invitar, editar rol/estado,
// reenviar/cancelar invitacion, aceptar invitacion) - separada de los
// endpoints, mismo patron que rolePermissions.ts/moduleEntities.ts.
//
// HU multi-organizacion (2026-09-04): "Usuarios" (esta pantalla) gestiona
// MEMBRESIAS (`users`) de un tenant puntual, no personas completas - ver el
// comentario largo en server/db/schema.ts sobre people vs. users.
// inviteUser() ahora tiene DOS caminos segun si el correo ya es una persona
// conocida (en cualquier otro tenant) o no: ver su comentario propio mas
// abajo.

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
 * email/fullName ahora viven en `people` - join desde la membresia.
 */
export async function listUsers(tenantId: string): Promise<UserSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        email: people.email,
        fullName: people.fullName,
        roleId: users.roleId,
        roleName: roles.name,
        isActive: users.isActive,
        invitationTokenHash: users.invitationTokenHash,
        invitationExpiresAt: users.invitationExpiresAt,
        createdAt: users.createdAt
      })
      .from(users)
      .innerJoin(people, eq(people.id, users.personId))
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
  inviteUrl?: string
}

/**
 * Invita un correo a este tenant (modal "Invitar usuario" del diseño real,
 * Screen/Usuarios). Dos caminos segun si `email` ya es una persona conocida
 * en CUALQUIER otro tenant (HU multi-organizacion, 2026-09-04):
 *
 * - Ya existe en `people`: solo se crea la membresia nueva, activa de
 *   inmediato (`isActive: true`, sin token de invitacion ni contraseña que
 *   fijar - la persona YA tiene contraseña, la misma en todas sus
 *   organizaciones). Se le avisa por correo, pero de forma best-effort (si
 *   SMTP no esta configurado o el envio falla, la membresia queda creada
 *   igual - a diferencia del camino de abajo, este correo es una
 *   notificacion, no el UNICO modo de que la persona pueda entrar: ya tiene
 *   contraseña y puede loguearse y ver la organización nueva en el selector).
 * - No existe: mismo flujo de siempre (ERD-84) - crea la persona con un
 *   placeholder de contraseña inutilizable y la membresia con
 *   isActive=false + token de invitacion, y el correo real (con enlace para
 *   fijar su contraseña) es OBLIGATORIO - si el envio falla, no queda nada
 *   creado (mismo criterio ya establecido, ver mas abajo).
 *
 * inviterFullName: nombre de quien invita (Screen/Usuarios no lo pide - lo
 * resuelve el propio endpoint del admin autenticado), usado solo en el
 * cuerpo del correo.
 */
export async function inviteUser(tenantId: string, email: string, roleId: string, inviterFullName: string): Promise<InviteUserResult> {
  const normalizedEmail = email.trim().toLowerCase()

  const outcome = await withTenant(tenantId, async (tx) => {
    const role = await assertRoleInTenant(tx, tenantId, roleId)
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    const tenantName = tenant?.name ?? 'tu organización'

    const [existingPerson] = await tx.select().from(people).where(eq(people.email, normalizedEmail)).limit(1)

    if (existingPerson) {
      let membershipRow: typeof users.$inferSelect
      try {
        ;[membershipRow] = await tx.insert(users).values({ tenantId, personId: existingPerson.id, roleId, isActive: true }).returning()
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
        if (code === PG_UNIQUE_VIOLATION) {
          throw new DuplicateEmailError(`"${normalizedEmail}" ya es miembro de este tenant`)
        }
        throw err
      }
      await enqueueCriticalEmailInTx(tx, tenantId, { to: existingPerson.email, platform: true, purpose: 'invitation', subject: `Te agregaron a ${tenantName} en Flow`,
        html: `<p>${escapeHtml(inviterFullName)} te agregó al espacio de trabajo de ${escapeHtml(tenantName)} con el rol de ${escapeHtml(role.name)}. Inicia sesión con tu contraseña habitual para elegir esta organización.</p>` })
      return { kind: 'existing' as const, membershipRow, person: existingPerson, tenantName, roleName: role.name }
    }

    // Placeholder inutilizable: people.passwordHash es NOT NULL y no hay
    // forma de dejarlo vacio - un hash de un valor aleatorio que nunca se
    // entrega a nadie. users.isActive=false ya es el gate real de login;
    // esto es solo para satisfacer la columna hasta que acceptInvitation()
    // fije la contraseña real elegida.
    const placeholderPassword = randomBytes(24).toString('hex')
    const placeholderHash = `!invited:${placeholderPassword}`
    const [newPerson] = await tx.insert(people).values({ email: normalizedEmail, passwordHash: placeholderHash }).returning()

    const token = generateInvitationToken(tenantId)
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRES_IN_MS)

    const [membershipRow] = await tx
      .insert(users)
      .values({ tenantId, personId: newPerson.id, roleId, isActive: false, invitationTokenHash: tokenHash, invitationExpiresAt: expiresAt })
      .returning()

    await enqueueCriticalEmailInTx(tx, tenantId, { to: newPerson.email, platform: true, purpose: 'invitation', subject: `Te invitaron a unirte a ${tenantName} en Flow`, html: 'Invitación protegida',
      encryptedHtml: encryptSetting(buildInvitationEmailHtml({ token, to: newPerson.email, tenantName, inviterName: inviterFullName, roleName: role.name, inviteUrl: `${getAppBaseUrl()}/invitacion/${token}` })) })
    return { kind: 'new' as const, membershipRow, person: newPerson, tenantName, roleName: role.name, token }
  })

  return {
    user: {
      id: outcome.membershipRow.id,
      email: outcome.person.email,
      fullName: outcome.person.fullName,
      roleId: outcome.membershipRow.roleId,
      roleName: outcome.roleName,
      isActive: outcome.membershipRow.isActive,
      status: outcome.kind === 'new' ? 'invitacion_pendiente' : 'activo',
      createdAt: outcome.membershipRow.createdAt
    },
    ...(outcome.kind === 'new' ? { inviteUrl: `${getAppBaseUrl()}/invitacion/${outcome.token}` } : {})
  }
}

/**
 * Reenvia la invitacion (boton "Reenviar" del listado, para una invitacion
 * ya vencida o que el destinatario perdio): genera un token nuevo (invalida
 * el anterior) y una expiracion nueva de 7 dias, y vuelve a mandar el
 * correo. Solo tiene sentido sobre una membresia que TODAVIA no acepto -
 * InvitationNotPendingError si ya es una cuenta activa.
 */
export async function resendInvitation(tenantId: string, userId: string, inviterFullName: string): Promise<InviteUserResult> {
  const token = generateInvitationToken(tenantId)
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRES_IN_MS)

  const { membershipRow, person, tenantName, roleName } = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, isActive: users.isActive, invitationTokenHash: users.invitationTokenHash, roleId: users.roleId, personId: users.personId })
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

    const [membershipRow] = await tx
      .update(users)
      .set({ invitationTokenHash: tokenHash, invitationExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning()

    const [person] = await tx.select().from(people).where(eq(people.id, existing.personId)).limit(1)
    await enqueueCriticalEmailInTx(tx, tenantId, { to: person!.email, platform: true, purpose: 'invitation', subject: `Te invitaron a unirte a ${tenantName} en Flow`, html: 'Invitación protegida',
      encryptedHtml: encryptSetting(buildInvitationEmailHtml({ token, to: person!.email, tenantName, inviterName: inviterFullName, roleName: role.name, inviteUrl: `${getAppBaseUrl()}/invitacion/${token}` })) })

    return { membershipRow, person: person!, tenantName, roleName: role.name }
  })

  return {
    user: {
      id: membershipRow.id,
      email: person.email,
      fullName: person.fullName,
      roleId: membershipRow.roleId,
      roleName,
      isActive: membershipRow.isActive,
      status: 'invitacion_pendiente',
      createdAt: membershipRow.createdAt
    },
    inviteUrl: `${getAppBaseUrl()}/invitacion/${token}`
  }
}

export interface UpdateUserInput {
  roleId?: string | null
  isActive?: boolean
}

/**
 * Edita rol y/o estado activo de una membresia ya existente (acciones de la
 * columna "Acciones" del listado). No permite tocar la propia cuenta
 * (CannotEditSelfError) - evita que un admin se quite el rol o se desactive
 * a si mismo por accidente y quede sin forma de revertirlo.
 */
export async function updateUser(tenantId: string, userId: string, actingUserId: string, input: UpdateUserInput): Promise<UserSummary> {
  if (userId === actingUserId) {
    throw new CannotEditSelfError('No puedes editar tu propio acceso desde esta pantalla')
  }

  let affectedConversationIds: string[] = []
  const result = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select({ id: users.id, personId: users.personId, isActive: users.isActive }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1)
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
    const [person] = await tx.select().from(people).where(eq(people.id, existing.personId)).limit(1)

    if (input.isActive !== undefined && existing.isActive !== input.isActive) {
      const memberships = await tx.select({ conversationId: chatParticipants.conversationId }).from(chatParticipants)
        .where(and(eq(chatParticipants.tenantId, tenantId), eq(chatParticipants.userId, userId)))
      affectedConversationIds = memberships.map(row => row.conversationId)
    }

    return {
      id: row.id,
      email: person!.email,
      fullName: person!.fullName,
      roleId: row.roleId,
      roleName,
      isActive: row.isActive,
      status: resolveStatus(row),
      createdAt: row.createdAt
    }
  })

  if (affectedConversationIds.length) {
    const recipients = await withTenant(tenantId, tx => tx.select({ id: chatParticipants.userId }).from(chatParticipants)
      .where(and(eq(chatParticipants.tenantId, tenantId), inArray(chatParticipants.conversationId, affectedConversationIds), ne(chatParticipants.userId, userId))))
    const recipientIds = [...new Set(recipients.map(row => row.id))]
    for (const recipientId of recipientIds) {
      publishRealtime(realtimeUserTopic(recipientId), 'chat.user.status', { userId, active: input.isActive, conversationIds: affectedConversationIds })
    }
  }
  return result
}

/**
 * Cancela una invitacion todavia pendiente (borra la fila de membresia
 * entera - no la persona, que podria tener otras membresias o ni siquiera
 * llegar a existir en ningun otro lado si esta era su primera invitacion,
 * en cuyo caso queda una fila de `people` huerfana con un placeholder
 * inutilizable - aceptable, mismo costo que cualquier invitacion cancelada
 * de siempre, y `people.email` unico global evita que alguien la reinvite
 * con un email distinto por accidente). InvitationNotPendingError si la
 * cuenta ya esta activa.
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
 * passwordPolicySchema en el endpoint) en `people` y activa la membresia.
 */
export async function acceptInvitation(token: string, newPassword: string, fullName?: string): Promise<{ tenantId: string }> {
  const { tenantId } = parseInvitationToken(token)
  const tokenHash = hashToken(token)
  const passwordHash = await hashPassword(newPassword)

  await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: users.id, personId: users.personId, invitationExpiresAt: users.invitationExpiresAt })
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
      .set({ isActive: true, invitationTokenHash: null, invitationExpiresAt: null, updatedAt: new Date() })
      .where(eq(users.id, row.id))

    await tx
      .update(people)
      .set({ passwordHash, emailVerifiedAt: new Date(), ...(fullName ? { fullName: fullName.trim() } : {}), updatedAt: new Date() })
      .where(eq(people.id, row.personId))
  })

  return { tenantId }
}
