import { and, eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions, users } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  return withTenant(auth.tenantId, async tx => {
    const available = auth.roleId ? await tx.select({ slug: entities.slug, name: entities.name, icon: entities.icon }).from(entities).innerJoin(roleEntityPermissions, and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, auth.roleId), eq(roleEntityPermissions.canRead, true))).where(and(eq(entities.tenantId, auth.tenantId), eq(entities.moduleKind, 'hecho'), eq(entities.isActive, true))).orderBy(entities.name) : []
    const [user] = await tx.select({ shortcuts: users.dashboardShortcuts }).from(users).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId))).limit(1)
    const allowed = new Set(available.map(item => item.slug))
    const saved = Array.isArray(user?.shortcuts) ? user.shortcuts.filter(slug => allowed.has(slug)) : []
    return { available, shortcuts: saved.length ? saved : available.slice(0, 4).map(item => item.slug) }
  })
})
