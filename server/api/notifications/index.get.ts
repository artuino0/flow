import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { getQuery } from 'h3'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notifications, records } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const query = getQuery(event)
  const parsedLimit = Number(query.limit ?? 30)
  const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, Math.floor(parsedLimit))) : 30
  return withTenant(auth.tenantId, async tx => {
    const visible = or(isNull(notifications.recordId), eq(records.id, notifications.recordId))
    const [items, unread] = await Promise.all([
      tx.select().from(notifications)
        .leftJoin(records, eq(records.id, notifications.recordId))
        .where(and(eq(notifications.userId, auth.sub), visible))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      tx.select({ id: notifications.id }).from(notifications)
        .leftJoin(records, eq(records.id, notifications.recordId))
        .where(and(eq(notifications.tenantId, auth.tenantId), eq(notifications.userId, auth.sub), isNull(notifications.readAt), visible))
    ])
    return { items: items.map(item => item.notifications), unreadCount: unread.length }
  })
})
