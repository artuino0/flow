import { and, eq, inArray } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { db } from '~/server/db'
import { notificationGroupMembers, notificationGroups, notifications, people, roles, users } from '~/server/db/schema'
import { publishRealtime, realtimeUserTopic, subscribeRealtime } from '~/server/utils/realtime'

type Tx = typeof db

export interface NotificationPayload {
  id: string
  tenantId: string
  userId: string
  type: string
  title: string
  message: string
  entitySlug: string | null
  recordId: string | null
  activityId: string | null
  actionUrl: string | null
  readAt: Date | null
  createdAt: Date
}

export interface NotificationRecipientInput {
  userIds?: string[]
  roleIds?: string[]
  groupIds?: string[]
  mentions?: string[]
}

export function subscribeNotifications(userId: string, listener: (payload: NotificationPayload) => void): () => void {
  return subscribeRealtime(realtimeUserTopic(userId), event => {
    if (event.type === 'notification.created') listener(event.payload as NotificationPayload)
  })
}

export function publishNotifications(payloads: NotificationPayload[]): void {
  for (const payload of payloads) {
    publishRealtime(realtimeUserTopic(payload.userId), 'notification.created', payload)
  }
}

export async function createNotifications(
  tx: Tx,
  input: {
    tenantId: string
    actorUserId?: string
    activityId?: string
    entitySlug?: string
    recordId?: string
    actionUrl?: string
    type?: string
    title: string
    message: string
    recipients: NotificationRecipientInput
  }
): Promise<NotificationPayload[]> {
  const directIds = [...(input.recipients.userIds ?? []), ...(input.recipients.mentions ?? [])]
  const roleIds = input.recipients.roleIds ?? []
  const groupIds = input.recipients.groupIds ?? []
  const candidateIds = new Set<string>()

  if (directIds.length) {
    const direct = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, input.tenantId), eq(users.isActive, true), inArray(users.id, directIds)))
    for (const row of direct) candidateIds.add(row.id)
  }

  if (roleIds.length) {
    const roleUsers = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, input.tenantId), eq(users.isActive, true), inArray(roles.id, roleIds), eq(roles.tenantId, input.tenantId)))
    for (const row of roleUsers) candidateIds.add(row.id)
  }

  if (groupIds.length) {
    const groupUsers = await tx
      .select({ id: users.id })
      .from(notificationGroupMembers)
      .innerJoin(notificationGroups, eq(notificationGroups.id, notificationGroupMembers.groupId))
      .innerJoin(users, eq(users.id, notificationGroupMembers.userId))
      .where(and(eq(notificationGroups.tenantId, input.tenantId), inArray(notificationGroups.id, groupIds), eq(users.tenantId, input.tenantId), eq(users.isActive, true)))
    for (const row of groupUsers) candidateIds.add(row.id)
  }

  if (input.actorUserId) candidateIds.delete(input.actorUserId)
  if (!candidateIds.size) return []

  const rows = await tx.insert(notifications).values(
    [...candidateIds].map(userId => ({
      tenantId: input.tenantId,
      userId,
      type: input.type ?? 'MENTION',
      title: input.title,
      message: input.message,
      entitySlug: input.entitySlug ?? null,
      recordId: input.recordId ?? null,
      activityId: input.activityId ?? null,
      actionUrl: input.actionUrl ?? null
    }))
  ).returning()

  return rows as NotificationPayload[]
}

export async function notificationRecipientOptions(tenantId: string) {
  return withTenant(tenantId, async tx => {
    const [userRows, roleRows, groupRows] = await Promise.all([
      tx.select({ id: users.id, name: people.fullName, email: people.email }).from(users).innerJoin(people, eq(people.id, users.personId)).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true))).orderBy(people.fullName),
      tx.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.tenantId, tenantId)).orderBy(roles.name),
      tx.select({ id: notificationGroups.id, name: notificationGroups.name }).from(notificationGroups).where(eq(notificationGroups.tenantId, tenantId)).orderBy(notificationGroups.name)
    ])
    return {
      users: userRows.map(row => ({ id: row.id, label: row.name || row.email, email: row.email })),
      roles: roleRows,
      groups: groupRows
    }
  })
}
