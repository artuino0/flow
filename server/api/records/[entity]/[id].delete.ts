import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'

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

  // HU-ERD-48: mismo criterio "fire-and-forget" que create/update - el
  // customData evaluado es el del record YA borrado (la unica version que
  // existe en este punto).
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_delete', row.id, row.customData as Record<string, unknown>)

  return { deleted: true, id: row.id }
})
