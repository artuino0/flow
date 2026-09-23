import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { recordNotDeleted } from '~/server/utils/records'
import { recalculateCalculatedDependents } from '~/server/utils/calculatedFields'

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canDelete')
  const row = await withTenant(auth.tenantId, async (tx) => {
    const [deleted] = await tx.update(records).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)).returning()
    if (deleted) await recalculateCalculatedDependents(tx, auth.tenantId, entity.id, deleted.customData as Record<string, unknown>, null)
    return deleted
  })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_delete', row.id, row.customData as Record<string, unknown>)
  return { deleted: true, id: row.id }
})
