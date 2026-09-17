import { requireAdminRole } from '~/server/utils/rbac'
import { getRoleChatPermissions } from '~/server/utils/chatPermissions'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const result = await getRoleChatPermissions(auth.tenantId, getRouterParam(event, 'id')!)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Rol no encontrado' })
  return result
})
