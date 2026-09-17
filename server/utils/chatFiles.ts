import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { chatAttachments, chatMessages, chatParticipants } from '~/server/db/schema'

const MAX_CHAT_FILE_BYTES = 15 * 1024 * 1024

function rootDir() {
  const base = process.env.FILES_STORAGE_DIR ? path.resolve(process.env.FILES_STORAGE_DIR) : path.resolve(process.cwd(), 'uploads')
  return path.join(base, 'chat')
}

function safeName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'archivo'
}

export async function storeChatAttachment(tenantId: string, userId: string, input: { fileName: string; mimeType: string; data: Buffer }) {
  if (input.data.length > MAX_CHAT_FILE_BYTES) throw createError({ statusCode: 413, statusMessage: 'El archivo supera el máximo permitido de 15 MB' })
  const id = randomUUID()
  const relative = path.join(tenantId, `${id}-${safeName(input.fileName)}`)
  const fullPath = path.join(rootDir(), relative)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, input.data)
  try {
    return await withTenant(tenantId, async tx => {
      const [row] = await tx.insert(chatAttachments).values({
        id, tenantId, uploadedBy: userId, fileName: input.fileName, mimeType: input.mimeType || 'application/octet-stream', sizeBytes: input.data.length, storageKey: relative
      }).returning()
      return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, url: `/api/chat/attachments/${row.id}` }
    })
  } catch (error) {
    fs.rmSync(fullPath, { force: true })
    throw error
  }
}

export async function getChatAttachment(tenantId: string, userId: string, id: string) {
  return withTenant(tenantId, async tx => {
    const [row] = await tx.select().from(chatAttachments).where(and(eq(chatAttachments.id, id), eq(chatAttachments.tenantId, tenantId))).limit(1)
    if (!row) return null
    if (row.uploadedBy !== userId) {
      if (!row.messageId) return null
      const [message] = await tx.select({ conversationId: chatMessages.conversationId }).from(chatMessages).where(eq(chatMessages.id, row.messageId)).limit(1)
      if (!message) return null
      const [member] = await tx.select({ id: chatParticipants.id }).from(chatParticipants).where(and(eq(chatParticipants.conversationId, message.conversationId), eq(chatParticipants.userId, userId))).limit(1)
      if (!member) return null
    }
    return { ...row, fullPath: path.join(rootDir(), row.storageKey) }
  })
}
