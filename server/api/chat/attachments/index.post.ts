import { requireChatPermission } from '~/server/utils/chatPermissions'
import { storeChatAttachment } from '~/server/utils/chatFiles'

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canSendAttachments')
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.filename)
  if (!file?.filename) throw createError({ statusCode: 422, statusMessage: 'No se recibió ningún archivo' })
  const result = await storeChatAttachment(auth.tenantId, auth.sub, { fileName: file.filename, mimeType: file.type || 'application/octet-stream', data: file.data })
  setResponseStatus(event, 201)
  return result
})
