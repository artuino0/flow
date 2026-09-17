import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { setConversationArchived } from '~/server/utils/chat'

const bodySchema = z.object({ archived: z.boolean() })
export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const body = await readValidatedBody(event, bodySchema.parse)
  return setConversationArchived(auth, getRouterParam(event, 'id')!, body.archived)
})
