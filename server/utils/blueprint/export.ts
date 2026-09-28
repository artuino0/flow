import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, entityFields, relationDefinitions } from '~/server/db/schema'
import { detailLayoutSchema } from '~/server/utils/detailLayout'
import { stateWorkflowSchema } from '~/server/utils/stateWorkflow'
import { calendarConfigSchema } from '~/server/utils/calendarConfig'
import { KNOWN_DATA_TYPES } from '~/server/utils/dynamicSchema'
import type { Blueprint, BlueprintField } from './schema'

export type BlueprintTx = typeof db

export async function loadBlueprintTenant(tx: BlueprintTx, tenantId: string) {
  const modules = await tx.select().from(entities).where(and(eq(entities.tenantId, tenantId), isNull(entities.deletedAt))).orderBy(entities.name)
  const ids = modules.map(module => module.id)
  const fields = ids.length ? await tx.select().from(entityFields).where(inArray(entityFields.entityId, ids)).orderBy(entityFields.sortOrder, entityFields.createdAt) : []
  const associations = await tx.select().from(relationDefinitions).where(eq(relationDefinitions.tenantId, tenantId))
  const fieldsById = new Map<string, typeof fields>()
  for (const field of fields) fieldsById.set(field.entityId, [...(fieldsById.get(field.entityId) ?? []), field])
  return { modules, fieldsById, associations }
}

export async function exportBlueprint(tenantId: string): Promise<Blueprint> {
  return withTenant(tenantId, async tx => {
    const current = await loadBlueprintTenant(tx, tenantId)
    const byId = new Map(current.modules.map(module => [module.id, module]))
    return {
      version: 1,
      summary: 'Estructura actual del tenant',
      modules: current.modules.map(module => {
        const layout = detailLayoutSchema.safeParse(module.detailLayout)
        const workflow = stateWorkflowSchema.safeParse(module.workflowConfig)
        const calendar = calendarConfigSchema.safeParse(module.calendarConfig)
        return {
          ref: module.slug,
          action: 'extend' as const,
          kind: module.moduleKind === 'dimension' ? 'dimension' as const : 'hecho' as const,
          name: module.name,
          slug: module.slug,
          ...(module.singularName ? { singularName: module.singularName } : {}),
          ...(module.icon ? { icon: module.icon } : {}),
          ...(module.description ? { description: module.description } : {}),
          fields: (current.fieldsById.get(module.id) ?? [])
            .filter(field => (KNOWN_DATA_TYPES as readonly string[]).includes(field.dataType))
            .map(field => ({ name: field.name, label: field.label, dataType: field.dataType as BlueprintField['dataType'], required: field.isRequired, isOwnerField: field.isOwnerField, validationRules: field.validationRules as Record<string, unknown> })),
          ...(layout.success ? { detailLayout: layout.data, lines: layout.data.relations.filter(relation => relation.editable).map(relation => ({ childRef: relation.entitySlug, relationField: relation.fieldName, ...(relation.totals ? { totals: relation.totals } : {}) })) } : {}),
          ...(workflow.success ? { workflow: workflow.data } : {}),
          ...(calendar.success ? { calendarConfig: calendar.data } : {}),
          snapshot: true
        }
      }),
      associations: current.associations.map(association => ({
        name: association.name,
        sourceRef: byId.get(association.sourceEntityId)?.slug ?? '',
        targetRef: byId.get(association.targetEntityId)?.slug ?? ''
      })).filter(association => association.sourceRef && association.targetRef)
    }
  })
}
