import { and, desc, eq, isNull } from 'drizzle-orm'
import { getQuery } from 'h3'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notifications } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const query = getQuery(event)
  const parsedLimit = Number(query.limit ?? 30)
  const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, Math.floor(parsedLimit))) : 30
  return withTenant(auth.tenantId, async tx => {
    const [items, unread] = await Promise.all([
      tx.select().from(notifications)
        .where(eq(notifications.userId, auth.sub))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      tx.select({ id: notifications.id }).from(notifications)
        .where(and(eq(notifications.tenantId, auth.tenantId), eq(notifications.userId, auth.sub), isNull(notifications.readAt)))
    ])
    return { items, unreadCount: unread.length }
  })
})
