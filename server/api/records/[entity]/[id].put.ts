import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { entityFields, records, recordActivities } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { recordNotDeleted } from '~/server/utils/records'
import { assertWritableRelations } from '~/server/utils/relationWriteGuard'
import { assertBlockingWorkflowActions, WorkflowTransitionBlockedError } from '~/server/utils/workflowPreflight'
import { applyCalculatedFields, isCalculatedField, recalculateCalculatedDependents } from '~/server/utils/calculatedFields'
import { assertEditableLineParents, enforceWorkflowChange, StateWorkflowError } from '~/server/utils/stateWorkflow'
import { setAgendaForce, agendaDatabaseError } from '~/server/utils/agendaConflict'

const bodySchema = z.object({ customData: z.record(z.any()), acknowledgeWarnings: z.boolean().optional(), agendaForceReason: z.string().trim().min(5).max(500).optional() })

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')
  const body = await readValidatedBody(event, bodySchema.parse)
  const dynamicSchema = await getEntityZodSchema(auth.tenantId, entity.id)
  let previousData: Record<string, unknown> | undefined

  const row = await withTenant(auth.tenantId, async (tx) => {
    await setAgendaForce(tx, auth, body.agendaForceReason)
    const [current] = await tx.select({ customData: records.customData }).from(records)
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)).limit(1)
    if (!current) return undefined

    const allFields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields).where(eq(entityFields.entityId, entity.id))
    const currentData = current.customData as Record<string, unknown>
    previousData = currentData
    const protectedNames = new Set(allFields.filter(field => field.dataType === 'incremental' || isCalculatedField(field)).map(field => field.name))
    let customData = Object.fromEntries(Object.entries(body.customData).filter(([name]) => !protectedNames.has(name)))
    for (const field of allFields) if (field.dataType === 'incremental') customData[field.name] = currentData[field.name]
    customData = await applyCalculatedFields(tx, auth.tenantId, entity.id, customData, id, allFields)

    const parsed = dynamicSchema.safeParse(customData)
    if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'customData invalido para esta entidad', data: parsed.error.flatten() })
    customData = parsed.data as Record<string, unknown>
    const changedNames = [...new Set([...Object.keys(currentData), ...Object.keys(customData)])].filter(name => JSON.stringify(currentData[name]) !== JSON.stringify(customData[name]))
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
    const changes = [...keys].filter(key => JSON.stringify(currentData[key]) !== JSON.stringify(customData[key]))
      .map(field => ({ field, old: currentData[field], new: customData[field] }))
    const [updated] = await tx.update(records).set({ customData, isDirty: false, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)).returning()
    if (changes.length) await tx.insert(recordActivities).values({ tenantId: auth.tenantId, recordId: id, userId: auth.sub, actionType: 'UPDATED', details: { changes } })
    await recalculateCalculatedDependents(tx, auth.tenantId, entity.id, currentData, customData)
    return updated
  }).catch(agendaDatabaseError)

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_update', row.id, row.customData as Record<string, unknown>, previousData)
  return row
})
