import { requireAdminRole } from '~/server/utils/rbac'
import { resolveChatPermissions } from '~/server/utils/chatPermissions'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const result = await resolveChatPermissions(auth.tenantId, getRouterParam(event, 'id')!)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado o inactivo' })
  return result
})
