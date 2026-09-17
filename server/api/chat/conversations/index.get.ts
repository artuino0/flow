import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { listConversations } from '~/server/utils/chat'

const querySchema = z.object({ archived: z.enum(['true', 'false']).optional().default('false') })

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const query = await getValidatedQuery(event, querySchema.parse)
  const items = await listConversations(auth, query.archived === 'true')
  return { items, unreadCount: items.reduce((sum, item) => sum + item.unreadCount, 0) }
})
