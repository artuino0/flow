import { requireAdminRole } from '~/server/utils/rbac'
import { getRolePermissions } from '~/server/utils/rolePermissions'

// GET /api/roles/:id/permissions (HU-ERD-33): permisos del rol sobre CADA
// entidad del tenant (en false por defecto donde todavia no hay fila en
// role_entity_permissions), para armar la matriz de checkboxes.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const roleId = getRouterParam(event, 'id')!

  const result = await getRolePermissions(auth.tenantId, roleId)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Rol no encontrado' })
  }
  return result
})
