import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { setRolePermissions } from '~/server/utils/rolePermissions'

// PUT /api/roles/:id/permissions (HU-ERD-33): guarda can_read/can_create/
// can_update/can_delete de este rol para el conjunto de entidades que venga
// en el body (upsert por (role_id, entity_id)). Cada entityId se revalida
// server-side contra las entidades del tenant autenticado - nunca se confia
// en un entityId suelto del body (podria pertenecer a otro tenant).
const bodySchema = z.object({
  permissions: z.array(
    z.object({
      entityId: z.string().uuid(),
      canRead: z.boolean(),
      canCreate: z.boolean(),
      canUpdate: z.boolean(),
      canDelete: z.boolean()
    })
  )
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const roleId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const result = await setRolePermissions(auth.tenantId, roleId, body.permissions)
  if (!result) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Rol no encontrado, o alguna entidad no pertenece a este tenant'
    })
  }
  return result
})
