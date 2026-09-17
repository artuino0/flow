import { requireAuth } from '~/server/utils/rbac'
import { resolveChatPermissions } from '~/server/utils/chatPermissions'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const permissions = await resolveChatPermissions(auth.tenantId, auth.sub)
  if (!permissions) throw createError({ statusCode: 403, statusMessage: 'No tienes acceso al chat' })
  return permissions
})
