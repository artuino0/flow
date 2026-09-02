import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { CannotEditSelfError, RoleNotFoundError, TargetUserNotFoundError, updateUser } from '~/server/utils/users'

// PUT /api/users/:id { roleId?, isActive? } - acciones "Cambiar rol" /
// "Activar"/"Desactivar" de la columna Acciones del listado.
const bodySchema = z
  .object({
    roleId: z.string().uuid().optional(),
    isActive: z.boolean().optional()
  })
  .refine((b) => b.roleId !== undefined || b.isActive !== undefined, { message: 'No hay ningún cambio para aplicar' })

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del usuario' })
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const user = await updateUser(auth.tenantId, id, auth.sub, body)
    return { user }
  } catch (err) {
    if (err instanceof TargetUserNotFoundError || err instanceof RoleNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof CannotEditSelfError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
