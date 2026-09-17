import { requireChatPermission } from '~/server/utils/chatPermissions'
import { deleteChatMessage } from '~/server/utils/chat'

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  return deleteChatMessage(auth, getRouterParam(event, 'id')!)
})
