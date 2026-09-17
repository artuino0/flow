import { and, eq, isNull } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notifications } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  await withTenant(auth.tenantId, tx => tx.update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.tenantId, auth.tenantId), eq(notifications.userId, auth.sub), isNull(notifications.readAt))))
  return { ok: true }
})
