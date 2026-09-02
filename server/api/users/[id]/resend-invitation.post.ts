import { eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { InvitationNotPendingError, TargetUserNotFoundError, resendInvitation } from '~/server/utils/users'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

// POST /api/users/:id/resend-invitation - boton "Reenviar" del listado sobre
// un usuario con invitacion pendiente (vencida o no): genera un token nuevo
// y vuelve a mandar el correo real.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del usuario' })

  const inviter = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, auth.sub)).limit(1)
    return row ?? null
  })
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
