import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { updateGroupConversation } from '~/server/utils/chat'

const bodySchema = z.object({ title: z.string().trim().min(1).max(100), userIds: z.array(z.string().uuid()).min(2).max(100) })
export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const body = await readValidatedBody(event, bodySchema.parse)
  return updateGroupConversation(auth, getRouterParam(event, 'id')!, body.title, body.userIds)
})
