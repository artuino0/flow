import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'
export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Usa tu sesión para administrar API keys' })
  const rows = await withTenant(auth.tenantId, tx => tx.select({
    id: entities.id, slug: entities.slug, name: entities.name,
    read: roleEntityPermissions.canRead, create: roleEntityPermissions.canCreate,
    update: roleEntityPermissions.canUpdate, delete: roleEntityPermissions.canDelete
  }).from(entities).innerJoin(roleEntityPermissions, and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, auth.roleId!))).where(eq(entities.isActive, true)))
  return { entities: rows.filter(row => row.read || row.create || row.update || row.delete) }
})
