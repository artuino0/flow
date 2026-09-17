import { and, eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notifications } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')!
  const [row] = await withTenant(auth.tenantId, tx => tx.update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, auth.tenantId), eq(notifications.userId, auth.sub)))
    .returning())
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Notificación no encontrada' })
  return row
})
