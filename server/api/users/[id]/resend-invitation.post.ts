import { eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { db, withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { InvitationNotPendingError, TargetUserNotFoundError, resendInvitation } from '~/server/utils/users'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

// POST /api/users/:id/resend-invitation - boton "Reenviar" del listado sobre
// un usuario con invitacion pendiente (vencida o no): genera un token nuevo
// y vuelve a mandar el correo real.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del usuario' })

  const membership = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select({ personId: users.personId }).from(users).where(eq(users.id, auth.sub)).limit(1)
    return row ?? null
  })
  const inviter = membership
    ? (await db.select({ email: people.email, fullName: people.fullName }).from(people).where(eq(people.id, membership.personId)).limit(1))[0]
    : null
  const inviterName = inviter?.fullName?.trim() || inviter?.email || 'Un administrador'

  try {
    const result = await resendInvitation(auth.tenantId, id, inviterName)
    return result
  } catch (err) {
    if (err instanceof TargetUserNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof InvitationNotPendingError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof SmtpNotConfiguredError) {
      throw createError({ statusCode: 500, statusMessage: err.message })
    }
    throw err
  }
})
