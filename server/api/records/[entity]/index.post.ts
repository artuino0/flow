import { defaultRecordValues } from '~/server/utils/fieldValidations/references'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { entityFields, records, recordActivities } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { generateIncrementalValue, MissingIncrementalPrefixError } from '~/server/utils/incrementalField'
import { assertWritableRelations } from '~/server/utils/relationWriteGuard'
import { applyCalculatedFields, recalculateCalculatedDependents, stripCalculatedValues } from '~/server/utils/calculatedFields'
import { stateWorkflowSchema, assertEditableLineParents, StateWorkflowError } from '~/server/utils/stateWorkflow'
import { setAgendaForce, agendaDatabaseError } from '~/server/utils/agendaConflict'

const bodySchema = z.object({ customData: z.record(z.any()).default({}), agendaForceReason: z.string().trim().min(5).max(500).optional() })

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canCreate')
  const body = await readValidatedBody(event, bodySchema.parse)
  const dynamicSchema = await getEntityZodSchema(auth.tenantId, entity.id, { userId: auth.sub })

  let row
  try {
    row = await withTenant(auth.tenantId, async (tx) => {
      await setAgendaForce(tx, auth, body.agendaForceReason)
      const allFields = await tx
        .select({ id: entityFields.id, name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
        .from(entityFields)
        .where(eq(entityFields.entityId, entity.id))

      let customData = await defaultRecordValues(tx, auth.tenantId, allFields, stripCalculatedValues(allFields, body.customData), auth.sub)
      const workflow = stateWorkflowSchema.safeParse(entity.workflowConfig)
      if (workflow.success && workflow.data.enabled) customData[workflow.data.field] = workflow.data.initial
      for (const field of allFields) {
        if (field.dataType === 'incremental') customData[field.name] = await generateIncrementalValue(tx, auth.tenantId, field, customData)
      }
      customData = await applyCalculatedFields(tx, auth.tenantId, entity.id, customData, undefined, allFields)

      const parsed = dynamicSchema.safeParse(customData)
      if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'customData invalido para esta entidad', data: parsed.error.flatten() })
      customData = parsed.data as Record<string, unknown>
      await assertWritableRelations(tx, auth.tenantId, allFields, customData)
      try { await assertEditableLineParents(tx, auth.tenantId, entity.id, allFields, customData) }
      catch (error) { if (error instanceof StateWorkflowError) throw createError({ statusCode: error.statusCode, statusMessage: error.message }); throw error }

      const [created] = await tx.insert(records).values({ entityId: entity.id, tenantId: auth.tenantId, customData }).returning()
      await tx.insert(recordActivities).values({ tenantId: auth.tenantId, recordId: created.id, userId: auth.sub, actionType: 'CREATED', details: { customData } })
      await recalculateCalculatedDependents(tx, auth.tenantId, entity.id, null, customData)
      return created
    })
  } catch (err) {
    if (err instanceof MissingIncrementalPrefixError) throw createError({ statusCode: 422, statusMessage: err.message })
    agendaDatabaseError(err)
  }

  fireTriggersForRecord(auth.tenantId, entity.id, 'on_create', row.id, row.customData as Record<string, unknown>)
  setResponseStatus(event, 201)
  return row
})
