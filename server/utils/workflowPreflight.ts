import { and, eq, sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, entityFields, records, triggerActions, triggers } from '~/server/db/schema'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { recordNotDeleted } from '~/server/utils/records'
import { conditionNodeSchema, evaluateCondition } from '~/server/utils/triggers'
import { upsertRecordConfigSchema } from '~/server/utils/triggerActions'

export class WorkflowTransitionBlockedError extends Error {
  fields: string[]
  constructor(fields: string[]) {
    super(`Completa estos datos antes de cambiar el estado: ${fields.join(', ')}`)
    this.fields = fields
  }
}

export async function assertBlockingWorkflowActions(
  tenantId: string,
  sourceEntityId: string,
  data: Record<string, unknown>,
  previousData: Record<string, unknown>
): Promise<void> {
  const matchingTriggers = await withTenant(tenantId, async tx => {
    const rows = await tx.select().from(triggers).where(and(
      eq(triggers.tenantId, tenantId),
      eq(triggers.entityId, sourceEntityId),
      eq(triggers.triggerEvent, 'on_update'),
      eq(triggers.isActive, true)
    ))
    return rows.filter(trigger => {
      const parsed = conditionNodeSchema.safeParse(trigger.condition)
      return parsed.success && evaluateCondition(parsed.data, data, previousData)
    })
  })
  if (!matchingTriggers.length) return

  const missingLabels = new Set<string>()
  for (const trigger of matchingTriggers) {
    const decisionParsed = conditionNodeSchema.safeParse(trigger.decisionCondition)
    const branch = decisionParsed.success ? (evaluateCondition(decisionParsed.data, data, previousData) ? 'yes' : 'no') : undefined
    const actions = await withTenant(tenantId, tx => tx.select().from(triggerActions).where(and(
      eq(triggerActions.tenantId, tenantId),
      eq(triggerActions.triggerId, trigger.id),
      eq(triggerActions.actionType, 'upsert_record')
    )))

    for (const action of actions) {
      const actionBranch = (action.config as { branch?: string } | null)?.branch
      if (branch && actionBranch && actionBranch !== branch) continue
      const config = upsertRecordConfigSchema.safeParse(action.config)
      if (!config.success) continue

      const [targetEntity] = await withTenant(tenantId, tx => tx.select({ id: entities.id, isActive: entities.isActive, deletedAt: entities.deletedAt })
        .from(entities).where(and(eq(entities.id, config.data.targetEntityId), eq(entities.tenantId, tenantId))).limit(1))
      if (!targetEntity?.isActive || targetEntity.deletedAt) continue

      const targetFields = await withTenant(tenantId, tx => tx.select({ name: entityFields.name, label: entityFields.label })
        .from(entityFields).where(eq(entityFields.entityId, targetEntity.id)))
      const labels = new Map(targetFields.map(field => [field.name, field.label]))
      const mapped: Record<string, unknown> = { ...config.data.values }
      for (const mapping of config.data.mappings) mapped[mapping.targetField] = data[mapping.sourceField]

      let existingData: Record<string, unknown> | undefined
      if (config.data.matchBy.length) {
        const conditions = config.data.matchBy.flatMap(mapping => {
          const value = data[mapping.sourceField]
          if (value === undefined || value === null || value === '') {
            missingLabels.add(mapping.sourceField)
            return []
          }
          return [dsql`${records.customData}->>${mapping.targetField} = ${String(value)}`]
        })
        if (conditions.length === config.data.matchBy.length) {
          const [existing] = await withTenant(tenantId, tx => tx.select({ customData: records.customData }).from(records).where(and(
            eq(records.tenantId, tenantId),
            eq(records.entityId, targetEntity.id),
            recordNotDeleted,
            ...conditions
          )).limit(1))
          existingData = existing?.customData as Record<string, unknown> | undefined
        }
      }

      if (existingData && config.data.existingBehavior === 'link_only') continue
      const targetSchema = await getEntityZodSchema(tenantId, targetEntity.id)
      const validation = targetSchema.safeParse(existingData ? { ...existingData, ...mapped } : mapped)
      if (!validation.success) {
        for (const field of Object.keys(validation.error.flatten().fieldErrors)) missingLabels.add(labels.get(field) ?? field)
      }
    }
  }

  if (missingLabels.size) throw new WorkflowTransitionBlockedError([...missingLabels])
}
