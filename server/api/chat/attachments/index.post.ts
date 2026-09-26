import { requireChatPermission } from '~/server/utils/chatPermissions'
import { ManagedFileTooLargeError, storeManagedChatAttachment } from '~/server/utils/managedStorage'
import { assertPlanCapacity } from '~/server/utils/billing'

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canSendAttachments')
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.filename)
  if (!file?.filename) throw createError({ statusCode: 422, statusMessage: 'No se recibió ningún archivo' })
  try {
    await assertPlanCapacity(auth.tenantId, 'storageBytes', file.data.length)
    const result = await storeManagedChatAttachment(auth.tenantId, auth.sub, { fileName: file.filename, mimeType: file.type || 'application/octet-stream', data: file.data })
    setResponseStatus(event, 201)
    return result
  } catch (error) {
    if (error instanceof ManagedFileTooLargeError) throw createError({ statusCode: 413, statusMessage: error.message })
    throw error
  }
})
