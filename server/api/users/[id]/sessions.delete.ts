import { and, eq, isNull } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { authSessions, users } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const userId = getRouterParam(event, 'id')!
  const count = await withTenant(auth.tenantId, async tx => {
    const [target] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, auth.tenantId))).limit(1)
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
    const rows = await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.tenantId, auth.tenantId), eq(authSessions.userId, userId), isNull(authSessions.revokedAt))).returning({ id: authSessions.id })
    return rows.length
  })
  return { revokedSessions: count }
})
