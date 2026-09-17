import { and, eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notificationGroups } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const groupId = getRouterParam(event, 'id')!
  const [deleted] = await withTenant(auth.tenantId, tx => tx.delete(notificationGroups).where(and(eq(notificationGroups.id, groupId), eq(notificationGroups.tenantId, auth.tenantId))).returning({ id: notificationGroups.id }))
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Grupo no encontrado' })
  return { ok: true }
})
