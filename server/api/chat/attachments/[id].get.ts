import fs from 'node:fs'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { getChatAttachment } from '~/server/utils/chatFiles'

export default defineEventHandler(async event => {
  const { auth } = await requireChatPermission(event, 'canAccess')
  const file = await getChatAttachment(auth.tenantId, auth.sub, getRouterParam(event, 'id')!)
  if (!file || !fs.existsSync(file.fullPath)) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  setResponseHeader(event, 'Content-Type', file.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  return sendStream(event, fs.createReadStream(file.fullPath))
})
