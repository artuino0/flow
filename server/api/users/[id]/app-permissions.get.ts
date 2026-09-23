import { resolveFlowCapabilities } from '~/server/utils/flowCapabilities'
import { requireAdminRole } from '~/server/utils/rbac'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const result = await resolveFlowCapabilities(auth.tenantId, getRouterParam(event, 'id')!)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado o inactivo' })
  return result
})
