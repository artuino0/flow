import { requireAdminRole } from '~/server/utils/rbac'
import { CannotEditSelfError, InvitationNotPendingError, TargetUserNotFoundError, cancelInvitation } from '~/server/utils/users'

// DELETE /api/users/:id - cancela una invitacion todavia pendiente (borra la
// fila). No sirve para desactivar una cuenta ya activa - eso es
// PUT /api/users/:id { isActive: false }, una accion distinta a proposito
// (ver comentario largo en server/utils/users.ts).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del usuario' })

  try {
    await cancelInvitation(auth.tenantId, id, auth.sub)
    return { ok: true }
  } catch (err) {
    if (err instanceof TargetUserNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof InvitationNotPendingError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof CannotEditSelfError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
