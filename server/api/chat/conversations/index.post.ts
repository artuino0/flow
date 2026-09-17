import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { createDirectConversation, createGroupConversation } from '~/server/utils/chat'

const bodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), userId: z.string().uuid() }),
  z.object({ type: z.literal('group'), title: z.string().trim().min(1).max(100), userIds: z.array(z.string().uuid()).min(2).max(100) })
])

export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const { auth } = await requireChatPermission(event, body.type === 'direct' ? 'canStartDirect' : 'canCreateGroups')
  const id = body.type === 'direct'
    ? await createDirectConversation(auth, body.userId)
    : await createGroupConversation(auth, body.title, body.userIds)
  setResponseStatus(event, 201)
  return { id }
})
