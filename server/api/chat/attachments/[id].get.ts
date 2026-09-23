import { StoredObjectNotFoundError } from '~/server/utils/objectStorage'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { getManagedChatAttachment, readManagedChatAttachment } from '~/server/utils/managedStorage'

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const file = await getManagedChatAttachment(auth.tenantId, auth.sub, getRouterParam(event, 'id')!)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  setResponseHeader(event, 'Content-Type', file.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  try {
    return await readManagedChatAttachment(file.storageKey)
  } catch (error) {
    if (error instanceof StoredObjectNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
    throw error
  }
})
