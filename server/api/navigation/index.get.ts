import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { listEntities } from '~/server/utils/moduleEntities'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const [tenant] = await db.select({ layout: tenants.navigationLayout, revision: tenants.navigationRevision }).from(tenants).where(eq(tenants.id, auth.tenantId))
  if (!tenant) throw createError({ statusCode: 404, statusMessage: 'Organización no encontrada' })
  const entities = await listEntities(auth.tenantId, 'hecho')
  const ids = new Set(entities.map(entity => entity.id))
  return { ...tenant, layout: { groups: tenant.layout.groups.map(group => ({ ...group, entityIds: group.entityIds.filter(id => ids.has(id)) })) }, entities }
})
