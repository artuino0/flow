import { getRoleFlowCapabilities } from '~/server/utils/flowCapabilities'
import { requireAdminRole } from '~/server/utils/rbac'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const result = await getRoleFlowCapabilities(auth.tenantId, getRouterParam(event, 'id')!)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Rol no encontrado' })
  return result
})
