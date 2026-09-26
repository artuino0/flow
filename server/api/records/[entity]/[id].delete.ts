import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields, records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { recordNotDeleted } from '~/server/utils/records'
import { recalculateCalculatedDependents } from '~/server/utils/calculatedFields'
import { assertEditableLineParents, assertWorkflowNotLocked, StateWorkflowError } from '~/server/utils/stateWorkflow'

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canDelete')
  const row = await withTenant(auth.tenantId, async (tx) => {
    const [current] = await tx.select({ customData: records.customData }).from(records)
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)).limit(1)
    if (current) {
      try { await assertWorkflowNotLocked(tx, auth.tenantId, entity.id, current.customData as Record<string, unknown>) }
      catch (error) {
        if (error instanceof StateWorkflowError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
        throw error
      }
      const fields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules }).from(entityFields).where(eq(entityFields.entityId, entity.id))
      try { await assertEditableLineParents(tx, auth.tenantId, entity.id, fields, current.customData as Record<string, unknown>) }
      catch (error) {
        if (error instanceof StateWorkflowError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
        throw error
      }
    }
    const [deleted] = await tx.update(records).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)).returning()
    if (deleted) await recalculateCalculatedDependents(tx, auth.tenantId, entity.id, deleted.customData as Record<string, unknown>, null)
    return deleted
  })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_delete', row.id, row.customData as Record<string, unknown>)
  return { deleted: true, id: row.id }
})
