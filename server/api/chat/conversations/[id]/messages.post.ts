import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'
import { sendChatMessage } from '~/server/utils/chat'

const bodySchema = z.object({
  clientMessageId: z.string().uuid(),
  body: z.string().max(10000).optional().default(''),
  replyToMessageId: z.string().uuid().nullable().optional(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional().default([]),
  sharedRecord: z.object({
    entitySlug: z.string().min(1).max(120),
    recordId: z.string().uuid(),
    label: z.string().min(1).max(240),
    url: z.string().regex(/^\/registros\//)
  }).nullable().optional(),
  gifUrl: z.string().url().regex(/^https:\/\/media[0-9]*\.giphy\.com\//).nullable().optional()
}).refine(body => body.body.trim().length > 0 || body.attachmentIds.length > 0 || Boolean(body.sharedRecord) || Boolean(body.gifUrl), { message: 'Escribe un mensaje, comparte un registro o adjunta un archivo' })

export default defineEventHandler(async event => {
  const { auth, permissions } = await requireChatPermission(event, 'canAccess')
  const body = await readValidatedBody(event, bodySchema.parse)
  if (body.attachmentIds.length && !permissions.effective.canSendAttachments) throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para enviar archivos' })
  const message = await sendChatMessage(auth, { conversationId: getRouterParam(event, 'id')!, ...body })
  setResponseStatus(event, 201)
  return message
})
