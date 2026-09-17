import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { listChatUsers } from '~/server/utils/chat'

const querySchema = z.object({ search: z.string().trim().max(100).optional().default('') })

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const query = await getValidatedQuery(event, querySchema.parse)
  return { users: await listChatUsers(auth, query.search) }
})
