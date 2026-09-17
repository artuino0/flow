import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { editChatMessage } from '~/server/utils/chat'

const bodySchema = z.object({ body: z.string().trim().min(1).max(10000) })
export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const body = await readValidatedBody(event, bodySchema.parse)
  return editChatMessage(auth, getRouterParam(event, 'id')!, body.body)
})
