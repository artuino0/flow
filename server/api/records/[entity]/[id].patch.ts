import { z } from 'zod'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { entityFields, recordActivities, records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { recordNotDeleted } from '~/server/utils/records'
import { assertWritableRelations } from '~/server/utils/relationWriteGuard'
import { assertBlockingWorkflowActions, WorkflowTransitionBlockedError } from '~/server/utils/workflowPreflight'
import { applyCalculatedFields, isCalculatedField, recalculateCalculatedDependents } from '~/server/utils/calculatedFields'
import { assertEditableLineParents, enforceWorkflowChange, StateWorkflowError } from '~/server/utils/stateWorkflow'

const bodySchema = z.object({
  changes: z.record(z.any()).refine(value => Object.keys(value).length > 0, 'Debes enviar al menos un cambio'),
  expectedUpdatedAt: z.string().datetime().optional()
  , acknowledgeWarnings: z.boolean().optional()
})

export default defineEventHandler(async event => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')
  const body = await readValidatedBody(event, bodySchema.parse)
  const dynamicSchema = await getEntityZodSchema(auth.tenantId, entity.id)

  const result = await withTenant(auth.tenantId, async tx => {
    const where = [eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted]
    const [current] = await tx.select().from(records).where(and(...where)).limit(1)
    if (!current) return { kind: 'missing' as const }
    if (body.expectedUpdatedAt && current.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()) return { kind: 'conflict' as const }

    const allFields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields).where(eq(entityFields.entityId, entity.id))
    const protectedNames = new Set(allFields.filter(field => field.dataType === 'incremental' || isCalculatedField(field)).map(field => field.name))
    const safeChanges = Object.fromEntries(Object.entries(body.changes).filter(([name]) => !protectedNames.has(name)))
    const currentData = (current.customData ?? {}) as Record<string, unknown>
    let customData = await applyCalculatedFields(tx, auth.tenantId, entity.id, { ...currentData, ...safeChanges }, id, allFields)
    const parsed = dynamicSchema.safeParse(customData)
    if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'Los cambios no son válidos para este módulo', data: parsed.error.flatten() })
    customData = parsed.data as Record<string, unknown>
    const changedNames = [...new Set([...Object.keys(currentData), ...Object.keys(customData)])].filter(field => JSON.stringify(currentData[field]) !== JSON.stringify(customData[field]))

    await assertWritableRelations(tx, auth.tenantId, allFields, customData, currentData)
    try {
      await assertEditableLineParents(tx, auth.tenantId, entity.id, allFields, customData)
      await assertEditableLineParents(tx, auth.tenantId, entity.id, allFields, currentData)
      await enforceWorkflowChange(tx, { tenantId: auth.tenantId, entityId: entity.id, roleId: auth.roleId!, userId: auth.sub, recordId: id, current: currentData, next: customData, changedFields: changedNames, acknowledgeWarnings: body.acknowledgeWarnings })
    } catch (error) {
      if (error instanceof StateWorkflowError && error.message.startsWith('WARNINGS:')) throw createError({ statusCode: 422, statusMessage: 'La transición tiene advertencias', data: { warnings: JSON.parse(error.message.slice(9)) } })
      if (error instanceof StateWorkflowError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
      throw error
    }
    try {
      await assertBlockingWorkflowActions(auth.tenantId, entity.id, customData, currentData)
    } catch (error) {
      if (error instanceof WorkflowTransitionBlockedError) throw createError({ statusCode: 422, statusMessage: error.message, data: { missingFields: error.fields } })
      throw error
    }

    const keys = new Set([...Object.keys(currentData), ...Object.keys(customData)])
    const changes = [...keys].filter(field => JSON.stringify(currentData[field]) !== JSON.stringify(customData[field]))
      .map(field => ({ field, old: currentData[field], new: customData[field] }))
    if (!changes.length) return { kind: 'updated' as const, row: current, previousData: currentData }

    const expectedUpdatedAt = current.updatedAt.toISOString()
    const [updated] = await tx.update(records).set({ customData, isDirty: false, updatedAt: new Date() })
      .where(and(...where, dsql`date_trunc('milliseconds', ${records.updatedAt}) = ${expectedUpdatedAt}::timestamptz`)).returning()
    if (!updated) return { kind: 'conflict' as const }

    await tx.insert(recordActivities).values({ tenantId: auth.tenantId, recordId: id, userId: auth.sub, actionType: 'UPDATED', details: { changes } })
    await recalculateCalculatedDependents(tx, auth.tenantId, entity.id, currentData, customData)
    return { kind: 'updated' as const, row: updated, previousData: currentData }
  })

  if (result.kind === 'missing') throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  if (result.kind === 'conflict') throw createError({ statusCode: 409, statusMessage: 'El registro cambió mientras lo estabas editando. Actualiza el tablero e inténtalo otra vez.' })
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_update', result.row.id, result.row.customData as Record<string, unknown>, result.previousData)
  return result.row
})
