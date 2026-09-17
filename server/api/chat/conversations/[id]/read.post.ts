import { requireChatPermission } from '~/server/utils/chatPermissions'
import { markConversationRead } from '~/server/utils/chat'

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  return markConversationRead(auth, getRouterParam(event, 'id')!)
})
