import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions, users } from '~/server/db/schema'

const bodySchema = z.object({ shortcuts: z.array(z.string()).max(8) })
export default defineEventHandler(async event => {
  const auth = requireAuth(event); const body = bodySchema.parse(await readBody(event))
  return withTenant(auth.tenantId, async tx => {
    const available = auth.roleId ? await tx.select({ slug: entities.slug }).from(entities).innerJoin(roleEntityPermissions, and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, auth.roleId), eq(roleEntityPermissions.canRead, true))).where(and(eq(entities.tenantId, auth.tenantId), eq(entities.moduleKind, 'hecho'), eq(entities.isActive, true))) : []
    const allowed = new Set(available.map(item => item.slug)); const shortcuts = [...new Set(body.shortcuts)].filter(slug => allowed.has(slug))
    await tx.update(users).set({ dashboardShortcuts: shortcuts, updatedAt: new Date() }).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId)))
    return { shortcuts }
  })
})
