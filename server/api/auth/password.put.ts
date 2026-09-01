import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { changeUserPassword, UserNotFoundError, WrongCurrentPasswordError } from '~/server/utils/changePassword'
import { passwordPolicySchema } from '~/server/utils/passwordPolicy'

// PUT /api/auth/password { currentPassword, newPassword } (HU-ERD-83 parte 1)
// Cambio de contraseña autoservicio - cualquier usuario autenticado, sobre
// su PROPIA cuenta (auth.sub). No existe endpoint para cambiar la contraseña
// de OTRO usuario: eso pertenece a la gestion de usuarios/invitaciones que
// dibuja Screen/Usuarios del .pen, que todavia no tiene ningun backend -
// gap real, distinto y mas grande que esta HU (ver comentario de Jira).
const bodySchema = z.object({
  currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'),
  newPassword: passwordPolicySchema
})

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    await changeUserPassword(auth.tenantId, auth.sub, body.currentPassword, body.newPassword)
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
    }
    if (err instanceof WrongCurrentPasswordError) {
      throw createError({ statusCode: 401, statusMessage: err.message })
    }
    throw err
  }

  return { ok: true }
})
