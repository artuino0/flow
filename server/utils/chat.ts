import { and, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { withTenant, db } from '~/server/db'
import { chatAttachments, chatConversations, chatMessages, chatParticipants, people, roles, users } from '~/server/db/schema'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { resolveChatPermissions } from '~/server/utils/chatPermissions'
import { publishRealtime, realtimeUserTopic } from '~/server/utils/realtime'
import type { ChatAttachment, ChatConversation, ChatMessage, ChatPerson } from '~/utils/chat'

type Tx = typeof db

async function participant(tx: Tx, tenantId: string, conversationId: string, userId: string) {
  const [row] = await tx.select().from(chatParticipants).where(and(
    eq(chatParticipants.tenantId, tenantId),
    eq(chatParticipants.conversationId, conversationId),
    eq(chatParticipants.userId, userId)
  )).limit(1)
  return row ?? null
}

async function peopleByUserIds(tx: Tx, tenantId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, ChatPerson>()
  const rows = await tx.select({ id: users.id, name: people.fullName, email: people.email, jobTitle: users.jobTitle })
    .from(users).innerJoin(people, eq(people.id, users.personId))
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, [...new Set(userIds)])))
  return new Map(rows.map(row => [row.id, { id: row.id, name: row.name || row.email, email: row.email, jobTitle: row.jobTitle }]))
}

function attachmentDto(row: typeof chatAttachments.$inferSelect): ChatAttachment {
  return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, url: `/api/chat/attachments/${row.id}` }
}

async function serializeMessages(tx: Tx, tenantId: string, rows: (typeof chatMessages.$inferSelect)[]): Promise<ChatMessage[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id)
  const replyIds = rows.flatMap(row => row.replyToMessageId ? [row.replyToMessageId] : [])
  const senderIds = rows.flatMap(row => row.senderUserId ? [row.senderUserId] : [])
  const [personMap, attachmentRows, replyRows] = await Promise.all([
    peopleByUserIds(tx, tenantId, senderIds),
    tx.select().from(chatAttachments).where(and(eq(chatAttachments.tenantId, tenantId), inArray(chatAttachments.messageId, ids))),
    replyIds.length ? tx.select().from(chatMessages).where(and(eq(chatMessages.tenantId, tenantId), inArray(chatMessages.id, replyIds))) : Promise.resolve([])
  ])
  const replySenderIds = replyRows.flatMap(row => row.senderUserId ? [row.senderUserId] : [])
  const replyPeople = await peopleByUserIds(tx, tenantId, replySenderIds)
  const attachmentsByMessage = new Map<string, ChatAttachment[]>()
  for (const file of attachmentRows) {
    if (!file.messageId) continue
    const list = attachmentsByMessage.get(file.messageId) ?? []
    list.push(attachmentDto(file))
    attachmentsByMessage.set(file.messageId, list)
  }
  const replies = new Map(replyRows.map(row => [row.id, row]))
  const readRows = await tx.select({ conversationId: chatParticipants.conversationId, userId: chatParticipants.userId, lastReadAt: chatParticipants.lastReadAt })
    .from(chatParticipants).where(and(eq(chatParticipants.tenantId, tenantId), inArray(chatParticipants.conversationId, [...new Set(rows.map(row => row.conversationId))])))

  return rows.map(row => {
    const reply = row.replyToMessageId ? replies.get(row.replyToMessageId) : undefined
    return {
      id: row.id,
      conversationId: row.conversationId,
      clientMessageId: row.clientMessageId,
      body: row.deletedAt ? '' : row.body,
      sender: row.senderUserId ? personMap.get(row.senderUserId) ?? null : null,
      replyTo: reply ? {
        id: reply.id,
        body: reply.deletedAt ? 'Mensaje eliminado' : reply.body,
        senderName: reply.senderUserId ? replyPeople.get(reply.senderUserId)?.name ?? 'Usuario' : 'Usuario'
      } : null,
      attachments: row.deletedAt ? [] : attachmentsByMessage.get(row.id) ?? [],
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      readCount: readRows.filter(read => read.conversationId === row.conversationId && read.userId !== row.senderUserId && read.lastReadAt >= row.createdAt).length
    }
  })
}

export async function assertConversationMember(tx: Tx, auth: AuthTokenPayload, conversationId: string) {
  const member = await participant(tx, auth.tenantId, conversationId, auth.sub)
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })
  return member
}

export async function listChatUsers(auth: AuthTokenPayload, search = '') {
  const term = search.trim().toLowerCase()
  const candidates = await withTenant(auth.tenantId, tx => tx.select({ id: users.id, name: people.fullName, email: people.email, jobTitle: users.jobTitle })
    .from(users).innerJoin(people, eq(people.id, users.personId))
    .where(and(eq(users.tenantId, auth.tenantId), eq(users.isActive, true), ne(users.id, auth.sub)))
    .orderBy(people.fullName).limit(100))
  const filtered = term ? candidates.filter(row => `${row.name ?? ''} ${row.email} ${row.jobTitle ?? ''}`.toLowerCase().includes(term)) : candidates
  const allowed = await Promise.all(filtered.map(async row => ({ row, permission: await resolveChatPermissions(auth.tenantId, row.id) })))
  return allowed.filter(item => item.permission?.effective.canAccess).map(({ row }) => ({ id: row.id, name: row.name || row.email, email: row.email, jobTitle: row.jobTitle }))
}

export async function createDirectConversation(auth: AuthTokenPayload, targetUserId: string) {
  if (targetUserId === auth.sub) throw createError({ statusCode: 422, statusMessage: 'Selecciona a otro trabajador' })
  const targetPermissions = await resolveChatPermissions(auth.tenantId, targetUserId)
  if (!targetPermissions?.effective.canAccess) throw createError({ statusCode: 422, statusMessage: 'Este trabajador no tiene acceso al chat' })
  const directKey = [auth.sub, targetUserId].sort().join(':')
  return withTenant(auth.tenantId, async tx => {
    const [validTarget] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, targetUserId), eq(users.tenantId, auth.tenantId), eq(users.isActive, true))).limit(1)
    if (!validTarget) throw createError({ statusCode: 404, statusMessage: 'Trabajador no encontrado' })
    await tx.insert(chatConversations).values({ tenantId: auth.tenantId, type: 'direct', directKey, createdBy: auth.sub }).onConflictDoNothing()
    const [conversation] = await tx.select().from(chatConversations).where(and(eq(chatConversations.tenantId, auth.tenantId), eq(chatConversations.directKey, directKey))).limit(1)
    if (!conversation) throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la conversación' })
    await tx.insert(chatParticipants).values([
      { tenantId: auth.tenantId, conversationId: conversation.id, userId: auth.sub, participantRole: 'owner' },
      { tenantId: auth.tenantId, conversationId: conversation.id, userId: targetUserId, participantRole: 'member' }
    ]).onConflictDoNothing()
    return conversation.id
  })
}

export async function createGroupConversation(auth: AuthTokenPayload, title: string, requestedUserIds: string[]) {
  const userIds = [...new Set([auth.sub, ...requestedUserIds.filter(id => id !== auth.sub)])]
  if (userIds.length < 3) throw createError({ statusCode: 422, statusMessage: 'Selecciona al menos dos participantes' })
  const access = await Promise.all(userIds.map(id => resolveChatPermissions(auth.tenantId, id)))
  if (access.some(permission => !permission?.effective.canAccess)) throw createError({ statusCode: 422, statusMessage: 'Uno o más participantes no tienen acceso al chat' })
  return withTenant(auth.tenantId, async tx => {
    const valid = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, auth.tenantId), eq(users.isActive, true), inArray(users.id, userIds)))
    if (valid.length !== userIds.length) throw createError({ statusCode: 422, statusMessage: 'Uno o más participantes no están disponibles' })
    const [conversation] = await tx.insert(chatConversations).values({ tenantId: auth.tenantId, type: 'group', title: title.trim(), createdBy: auth.sub }).returning()
    await tx.insert(chatParticipants).values(userIds.map(userId => ({ tenantId: auth.tenantId, conversationId: conversation.id, userId, participantRole: userId === auth.sub ? 'owner' : 'member' })))
    return conversation.id
  })
}

export async function listConversations(auth: AuthTokenPayload, archived: boolean): Promise<ChatConversation[]> {
  return withTenant(auth.tenantId, async tx => {
    const [currentRole] = auth.roleId ? await tx.select({ isSystem: roles.isSystem }).from(roles).where(and(eq(roles.id, auth.roleId), eq(roles.tenantId, auth.tenantId))).limit(1) : []
    const memberships = await tx.select({ participant: chatParticipants, conversation: chatConversations })
      .from(chatParticipants).innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
      .where(and(
        eq(chatParticipants.tenantId, auth.tenantId),
        eq(chatParticipants.userId, auth.sub),
        archived ? sql`${chatParticipants.archivedAt} is not null` : isNull(chatParticipants.archivedAt)
      )).orderBy(desc(chatConversations.lastMessageAt)).limit(100)
    const result: ChatConversation[] = []
    for (const item of memberships) {
      const participantRows = await tx.select().from(chatParticipants).where(eq(chatParticipants.conversationId, item.conversation.id))
      const personMap = await peopleByUserIds(tx, auth.tenantId, participantRows.map(row => row.userId))
      const persons = participantRows.map(row => personMap.get(row.userId)).filter((row): row is ChatPerson => Boolean(row))
      const [last] = await tx.select().from(chatMessages).where(eq(chatMessages.conversationId, item.conversation.id)).orderBy(desc(chatMessages.createdAt)).limit(1)
      const [unread] = await tx.select({ count: sql<number>`count(*)::int` }).from(chatMessages).where(and(
        eq(chatMessages.conversationId, item.conversation.id),
        gt(chatMessages.createdAt, item.participant.lastReadAt),
        or(isNull(chatMessages.senderUserId), ne(chatMessages.senderUserId, auth.sub))
      ))
      const directOther = persons.find(person => person.id !== auth.sub)
      result.push({
        id: item.conversation.id,
        type: item.conversation.type as 'direct' | 'group',
        title: item.conversation.type === 'direct' ? directOther?.name ?? 'Conversación' : item.conversation.title || 'Grupo',
        participants: persons,
        participantCount: persons.length,
        lastMessage: last ? { id: last.id, body: last.deletedAt ? 'Mensaje eliminado' : last.body, createdAt: last.createdAt.toISOString(), deletedAt: last.deletedAt?.toISOString() ?? null, senderId: last.senderUserId, senderName: last.senderUserId ? personMap.get(last.senderUserId)?.name ?? null : null } : null,
        lastMessageAt: item.conversation.lastMessageAt.toISOString(),
        unreadCount: unread?.count ?? 0,
        archivedAt: item.participant.archivedAt?.toISOString() ?? null,
        canManage: item.participant.participantRole === 'owner' || Boolean(currentRole?.isSystem)
      })
    }
    return result
  })
}

export async function updateGroupConversation(auth: AuthTokenPayload, conversationId: string, title: string, requestedUserIds: string[]) {
  const userIds = [...new Set([auth.sub, ...requestedUserIds.filter(id => id !== auth.sub)])]
  if (userIds.length < 3) throw createError({ statusCode: 422, statusMessage: 'Selecciona al menos dos participantes' })
  const access = await Promise.all(userIds.map(id => resolveChatPermissions(auth.tenantId, id)))
  if (access.some(permission => !permission?.effective.canAccess)) throw createError({ statusCode: 422, statusMessage: 'Uno o más participantes no tienen acceso al chat' })
  const participantResult = await withTenant(auth.tenantId, async tx => {
    const member = await assertConversationMember(tx, auth, conversationId)
    const [conversation] = await tx.select().from(chatConversations).where(and(eq(chatConversations.id, conversationId), eq(chatConversations.tenantId, auth.tenantId))).limit(1)
    if (!conversation || conversation.type !== 'group') throw createError({ statusCode: 404, statusMessage: 'Grupo no encontrado' })
    const [currentRole] = auth.roleId ? await tx.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, auth.roleId)).limit(1) : []
    if (member.participantRole !== 'owner' && !currentRole?.isSystem) throw createError({ statusCode: 403, statusMessage: 'No puedes administrar este grupo' })
    const valid = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, auth.tenantId), eq(users.isActive, true), inArray(users.id, userIds)))
    if (valid.length !== userIds.length) throw createError({ statusCode: 422, statusMessage: 'Uno o más participantes no están disponibles' })
    const existing = await tx.select().from(chatParticipants).where(eq(chatParticipants.conversationId, conversationId))
    const ownerIds = existing.filter(row => row.participantRole === 'owner').map(row => row.userId)
    const finalIds = [...new Set([...userIds, ...ownerIds])]
    const removedIds = existing.map(row => row.userId).filter(userId => !finalIds.includes(userId))
    if (removedIds.length) await tx.delete(chatParticipants).where(and(eq(chatParticipants.conversationId, conversationId), notInArray(chatParticipants.userId, finalIds)))
    await tx.insert(chatParticipants).values(finalIds.map(userId => ({ tenantId: auth.tenantId, conversationId, userId, participantRole: ownerIds.includes(userId) ? 'owner' : 'member' }))).onConflictDoNothing()
    await tx.update(chatConversations).set({ title: title.trim(), updatedAt: new Date() }).where(eq(chatConversations.id, conversationId))
    return { participantIds: finalIds, removedIds }
  })
  const affectedIds = [...new Set([...participantResult.participantIds, ...participantResult.removedIds])]
  for (const userId of affectedIds) publishRealtime(realtimeUserTopic(userId), 'chat.conversation.updated', { conversationId })
  return { id: conversationId }
}

export async function getMessages(auth: AuthTokenPayload, conversationId: string, before?: Date, limit = 50) {
  return withTenant(auth.tenantId, async tx => {
    await assertConversationMember(tx, auth, conversationId)
    const condition = before
      ? and(eq(chatMessages.tenantId, auth.tenantId), eq(chatMessages.conversationId, conversationId), lt(chatMessages.createdAt, before))
      : and(eq(chatMessages.tenantId, auth.tenantId), eq(chatMessages.conversationId, conversationId))
    const rows = await tx.select().from(chatMessages).where(condition).orderBy(desc(chatMessages.createdAt)).limit(limit)
    const ordered = rows.reverse()
    return { items: await serializeMessages(tx, auth.tenantId, ordered), nextCursor: rows.length === limit ? ordered[0]?.createdAt.toISOString() ?? null : null }
  })
}

export interface SendChatMessageInput {
  conversationId: string
  clientMessageId: string
  body: string
  replyToMessageId?: string | null
  attachmentIds?: string[]
}

export async function sendChatMessage(auth: AuthTokenPayload, input: SendChatMessageInput): Promise<ChatMessage> {
  const attachmentIds = [...new Set(input.attachmentIds ?? [])]
  const message = await withTenant(auth.tenantId, async tx => {
    await assertConversationMember(tx, auth, input.conversationId)
    if (input.replyToMessageId) {
      const [reply] = await tx.select({ id: chatMessages.id }).from(chatMessages).where(and(eq(chatMessages.id, input.replyToMessageId), eq(chatMessages.conversationId, input.conversationId))).limit(1)
      if (!reply) throw createError({ statusCode: 422, statusMessage: 'El mensaje respondido ya no existe' })
    }
    if (attachmentIds.length) {
      const files = await tx.select().from(chatAttachments).where(and(eq(chatAttachments.tenantId, auth.tenantId), eq(chatAttachments.uploadedBy, auth.sub), isNull(chatAttachments.messageId), inArray(chatAttachments.id, attachmentIds)))
      if (files.length !== attachmentIds.length) throw createError({ statusCode: 422, statusMessage: 'Uno o más archivos no están disponibles' })
    }
    await tx.insert(chatMessages).values({
      tenantId: auth.tenantId,
      conversationId: input.conversationId,
      senderUserId: auth.sub,
      clientMessageId: input.clientMessageId,
      body: input.body.trim(),
      replyToMessageId: input.replyToMessageId || null
    }).onConflictDoNothing()
    const [row] = await tx.select().from(chatMessages).where(and(eq(chatMessages.conversationId, input.conversationId), eq(chatMessages.senderUserId, auth.sub), eq(chatMessages.clientMessageId, input.clientMessageId))).limit(1)
    if (!row) throw createError({ statusCode: 500, statusMessage: 'No se pudo guardar el mensaje' })
    if (attachmentIds.length) await tx.update(chatAttachments).set({ messageId: row.id }).where(inArray(chatAttachments.id, attachmentIds))
    await tx.update(chatConversations).set({ lastMessageAt: row.createdAt, updatedAt: new Date() }).where(eq(chatConversations.id, input.conversationId))
    await tx.update(chatParticipants).set({ lastReadAt: row.createdAt }).where(and(eq(chatParticipants.conversationId, input.conversationId), eq(chatParticipants.userId, auth.sub)))
    await tx.update(chatParticipants).set({ archivedAt: null }).where(and(eq(chatParticipants.conversationId, input.conversationId), ne(chatParticipants.userId, auth.sub)))
    const [serialized] = await serializeMessages(tx, auth.tenantId, [row])
    return serialized
  })
  const userIds = await withTenant(auth.tenantId, tx => tx.select({ id: chatParticipants.userId }).from(chatParticipants).where(eq(chatParticipants.conversationId, input.conversationId)))
  for (const user of userIds) publishRealtime(realtimeUserTopic(user.id), 'chat.message', message)
  return message
}

export async function markConversationRead(auth: AuthTokenPayload, conversationId: string) {
  const readAt = await withTenant(auth.tenantId, async tx => {
    const member = await assertConversationMember(tx, auth, conversationId)
    const [latest] = await tx.select({ createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(1)
    const nextReadAt = new Date(Math.max(
      member.lastReadAt.getTime(),
      Date.now(),
      latest?.createdAt?.getTime() ?? 0
    ))
    await tx.update(chatParticipants).set({ lastReadAt: nextReadAt }).where(eq(chatParticipants.id, member.id))
    return nextReadAt
  })
  const userIds = await withTenant(auth.tenantId, tx => tx.select({ id: chatParticipants.userId }).from(chatParticipants).where(eq(chatParticipants.conversationId, conversationId)))
  for (const user of userIds) publishRealtime(realtimeUserTopic(user.id), 'chat.read', { conversationId, userId: auth.sub, readAt: readAt.toISOString() })
  return { readAt: readAt.toISOString() }
}

export async function setConversationArchived(auth: AuthTokenPayload, conversationId: string, archived: boolean) {
  return withTenant(auth.tenantId, async tx => {
    const member = await assertConversationMember(tx, auth, conversationId)
    const archivedAt = archived ? new Date() : null
    await tx.update(chatParticipants).set({ archivedAt }).where(eq(chatParticipants.id, member.id))
    return { archivedAt: archivedAt?.toISOString() ?? null }
  })
}

export async function editChatMessage(auth: AuthTokenPayload, messageId: string, body: string) {
  const message = await withTenant(auth.tenantId, async tx => {
    const [existing] = await tx.select().from(chatMessages).where(and(eq(chatMessages.id, messageId), eq(chatMessages.tenantId, auth.tenantId), eq(chatMessages.senderUserId, auth.sub), isNull(chatMessages.deletedAt))).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Mensaje no encontrado' })
    await assertConversationMember(tx, auth, existing.conversationId)
    const [row] = await tx.update(chatMessages).set({ body: body.trim(), editedAt: new Date() }).where(eq(chatMessages.id, messageId)).returning()
    return (await serializeMessages(tx, auth.tenantId, [row]))[0]
  })
  const userIds = await withTenant(auth.tenantId, tx => tx.select({ id: chatParticipants.userId }).from(chatParticipants).where(eq(chatParticipants.conversationId, message.conversationId)))
  for (const user of userIds) publishRealtime(realtimeUserTopic(user.id), 'chat.updated', message)
  return message
}

export async function deleteChatMessage(auth: AuthTokenPayload, messageId: string) {
  const message = await withTenant(auth.tenantId, async tx => {
    const [existing] = await tx.select().from(chatMessages).where(and(eq(chatMessages.id, messageId), eq(chatMessages.tenantId, auth.tenantId), eq(chatMessages.senderUserId, auth.sub))).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Mensaje no encontrado' })
    await assertConversationMember(tx, auth, existing.conversationId)
    const [row] = await tx.update(chatMessages).set({ body: '', deletedAt: existing.deletedAt ?? new Date() }).where(eq(chatMessages.id, messageId)).returning()
    return (await serializeMessages(tx, auth.tenantId, [row]))[0]
  })
  const userIds = await withTenant(auth.tenantId, tx => tx.select({ id: chatParticipants.userId }).from(chatParticipants).where(eq(chatParticipants.conversationId, message.conversationId)))
  for (const user of userIds) publishRealtime(realtimeUserTopic(user.id), 'chat.deleted', message)
  return message
}

export async function publishTyping(auth: AuthTokenPayload, conversationId: string, active: boolean) {
  const permissions = await resolveChatPermissions(auth.tenantId, auth.sub)
  if (!permissions?.effective.canAccess) return
  const userIds = await withTenant(auth.tenantId, async tx => {
    await assertConversationMember(tx, auth, conversationId)
    return tx.select({ id: chatParticipants.userId }).from(chatParticipants).where(and(eq(chatParticipants.conversationId, conversationId), ne(chatParticipants.userId, auth.sub)))
  })
  for (const user of userIds) publishRealtime(realtimeUserTopic(user.id), 'chat.typing', { conversationId, userId: auth.sub, active })
}

export async function publishChatPresence(auth: AuthTokenPayload, active: boolean) {
  const permissions = await resolveChatPermissions(auth.tenantId, auth.sub)
  if (!permissions?.effective.canAccess) return
  const recipients = await withTenant(auth.tenantId, async tx => {
    const own = await tx.select({ conversationId: chatParticipants.conversationId }).from(chatParticipants).where(and(eq(chatParticipants.tenantId, auth.tenantId), eq(chatParticipants.userId, auth.sub)))
    if (!own.length) return []
    return tx.selectDistinct({ id: chatParticipants.userId }).from(chatParticipants).where(and(
      eq(chatParticipants.tenantId, auth.tenantId),
      inArray(chatParticipants.conversationId, own.map(row => row.conversationId)),
      ne(chatParticipants.userId, auth.sub)
    ))
  })
  for (const user of recipients) publishRealtime(realtimeUserTopic(user.id), 'chat.presence', { userId: auth.sub, active, at: new Date().toISOString() })
}
