import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { setRoleChatPermissions } from '~/server/utils/chatPermissions'

const bodySchema = z.object({ canAccess: z.boolean(), canStartDirect: z.boolean(), canSendAttachments: z.boolean(), canCreateGroups: z.boolean() })
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const result = await setRoleChatPermissions(auth.tenantId, getRouterParam(event, 'id')!, body)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Rol no encontrado' })
  return result
})
