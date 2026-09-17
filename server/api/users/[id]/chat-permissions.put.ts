import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { setUserChatPermissionOverrides } from '~/server/utils/chatPermissions'

const value = z.boolean().nullable()
const bodySchema = z.object({ canAccess: value, canStartDirect: value, canSendAttachments: value, canCreateGroups: value })
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const result = await setUserChatPermissionOverrides(auth.tenantId, getRouterParam(event, 'id')!, body)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  return result
})
