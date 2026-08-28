import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// DELETE /api/records/:entity/:id (HU-ERD-16)
export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canDelete')

  const row = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .delete(records)
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id)))
      .returning()
    return r
  })

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }
  return { deleted: true, id: row.id }
})
