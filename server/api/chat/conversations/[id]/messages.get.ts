import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { getMessages } from '~/server/utils/chat'

const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
})

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const conversationId = getRouterParam(event, 'id')!
  const query = await getValidatedQuery(event, querySchema.parse)
  return getMessages(auth, conversationId, query.before ? new Date(query.before) : undefined, query.limit)
})
