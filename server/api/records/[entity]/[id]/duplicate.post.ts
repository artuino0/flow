import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entities, entityFields, recordActivities, records } from '~/server/db/schema'
import { buildFieldType } from '~/server/utils/dynamicSchema'
import { computeInverseRelations, resolveDetailLayout } from '~/server/utils/detailLayout'
import { generateIncrementalValue, MissingIncrementalPrefixError } from '~/server/utils/incrementalField'
import { applyCalculatedFields, isCalculatedField, recalculateCalculatedDependents } from '~/server/utils/calculatedFields'
import { assertWritableRelations } from '~/server/utils/relationWriteGuard'
import { stateWorkflowSchema } from '~/server/utils/stateWorkflow'
import { recordNotDeleted } from '~/server/utils/records'
import { fireTriggersForRecord } from '~/server/utils/triggers'

type Field = typeof entityFields.$inferSelect

function copyValues(fields: Field[], original: Record<string, unknown>, workflowConfig: unknown): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.dataType === 'incremental' || field.dataType === 'file' || isCalculatedField(field)) continue
    if (Object.hasOwn(original, field.name)) copy[field.name] = original[field.name]
  }
  const workflow = stateWorkflowSchema.safeParse(workflowConfig)
  if (workflow.success && workflow.data.enabled) copy[workflow.data.field] = workflow.data.initial
  return copy
}

function sourceLabel(fields: Field[], data: Record<string, unknown>, labelField: string | null | undefined, id: string): string {
  const folio = fields.find(field => field.dataType === 'incremental' && typeof data[field.name] === 'string')
  const label = labelField ? data[labelField] : undefined
  const fallback = fields.find(field => field.dataType === 'text' && typeof data[field.name] === 'string' && data[field.name])
  return String((folio && data[folio.name]) || label || (fallback && data[fallback.name]) || id.slice(0, 8))
}

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canCreate')

  // Los permisos de creación de cada módulo hijo se comprueban antes de escribir.
  const relationSlugs = await withTenant(auth.tenantId, async tx => {
    const [source] = await tx.select({ id: records.id }).from(records)
      .where(and(eq(records.id, id), eq(records.entityId, entity.id), eq(records.tenantId, auth.tenantId), recordNotDeleted)).limit(1)
    if (!source) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
    const fields = await tx.select({ name: entityFields.name }).from(entityFields).where(eq(entityFields.entityId, entity.id))
    const inverse = await computeInverseRelations(tx, auth.tenantId, entity.slug)
    const layout = resolveDetailLayout(entity.detailLayout, fields.map(field => field.name), inverse)
    return [...new Set(layout.relations.filter(relation => relation.editable).map(relation => relation.entitySlug))]
  })
  for (const slug of relationSlugs) await requirePermission(event, slug, 'canCreate')

  try {
    const result = await withTenant(auth.tenantId, async tx => {
      const [source] = await tx.select().from(records)
        .where(and(eq(records.id, id), eq(records.entityId, entity.id), eq(records.tenantId, auth.tenantId), recordNotDeleted)).limit(1)
      if (!source) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })

      const parentFields = await tx.select().from(entityFields).where(eq(entityFields.entityId, entity.id))
      const inverse = await computeInverseRelations(tx, auth.tenantId, entity.slug)
      const layout = resolveDetailLayout(entity.detailLayout, parentFields.map(field => field.name), inverse)
      const sourceData = source.customData as Record<string, unknown>
      let parentData = copyValues(parentFields, sourceData, entity.workflowConfig)
      for (const field of parentFields) {
        if (field.dataType === 'incremental') parentData[field.name] = await generateIncrementalValue(tx, auth.tenantId, field, parentData)
      }
      parentData = await applyCalculatedFields(tx, auth.tenantId, entity.id, parentData, undefined, parentFields)
      const parentSchema = z.object(Object.fromEntries(parentFields.map(field => [field.name, buildFieldType(field)])))
      const parsedParent = parentSchema.safeParse(parentData)
      if (!parsedParent.success) throw createError({ statusCode: 422, statusMessage: 'No se puede duplicar el encabezado con el esquema actual', data: parsedParent.error.flatten() })
      parentData = parsedParent.data as Record<string, unknown>
      await assertWritableRelations(tx, auth.tenantId, parentFields, parentData)
      const [created] = await tx.insert(records).values({ tenantId: auth.tenantId, entityId: entity.id, customData: parentData }).returning()
      const createdChildren: Array<{ entityId: string; id: string; customData: Record<string, unknown> }> = []
      const label = sourceLabel(parentFields, sourceData, entity.labelField, source.id)
      await tx.insert(recordActivities).values({ tenantId: auth.tenantId, recordId: created.id, userId: auth.sub, actionType: 'CREATED', details: { text: `Duplicado de ${label}`, sourceRecordId: source.id } })

      const copiedRelations = new Set<string>()
      for (const relation of layout.relations.filter(item => item.editable)) {
        const relationKey = `${relation.entitySlug}\0${relation.fieldName}`
        if (copiedRelations.has(relationKey)) continue
        copiedRelations.add(relationKey)
        const [childEntity] = await tx.select().from(entities)
          .where(and(eq(entities.tenantId, auth.tenantId), eq(entities.slug, relation.entitySlug))).limit(1)
        if (!childEntity) continue
        const childFields = await tx.select().from(entityFields).where(eq(entityFields.entityId, childEntity.id))
        const childSchema = z.object(Object.fromEntries(childFields.map(field => [field.name, buildFieldType(field)])))
        const children = await tx.select().from(records).where(and(
          eq(records.tenantId, auth.tenantId), eq(records.entityId, childEntity.id), ne(records.id, created.id), recordNotDeleted,
          sql`${records.customData}->>${relation.fieldName} = ${source.id}`
        )).orderBy(records.createdAt, records.id)
        for (const child of children) {
          const original = child.customData as Record<string, unknown>
          let data = copyValues(childFields, original, childEntity.workflowConfig)
          data[relation.fieldName] = created.id
          for (const field of childFields) {
            if (field.dataType === 'incremental') data[field.name] = await generateIncrementalValue(tx, auth.tenantId, field, data)
          }
          data = await applyCalculatedFields(tx, auth.tenantId, childEntity.id, data, undefined, childFields)
          const parsedChild = childSchema.safeParse(data)
          if (!parsedChild.success) throw createError({ statusCode: 422, statusMessage: `No se puede duplicar una partida de ${relation.entitySlug} con el esquema actual`, data: parsedChild.error.flatten() })
          data = parsedChild.data as Record<string, unknown>
          await assertWritableRelations(tx, auth.tenantId, childFields, data)
          // La creación de la copia no es una edición del padre: incluso un
          // estado inicial bloqueado debe poder recibir sus partidas copiadas.
          const [createdChild] = await tx.insert(records).values({ tenantId: auth.tenantId, entityId: childEntity.id, customData: data }).returning({ id: records.id, customData: records.customData })
          createdChildren.push({ entityId: childEntity.id, id: createdChild.id, customData: createdChild.customData as Record<string, unknown> })
          await recalculateCalculatedDependents(tx, auth.tenantId, childEntity.id, null, data)
        }
      }
      // El encabezado se calculó antes de insertar las partidas; se actualiza
      // al final para incluir incluso acumulados que no dependen de una línea.
      const finalData = await applyCalculatedFields(tx, auth.tenantId, entity.id, parentData, created.id, parentFields)
      const [final] = await tx.update(records).set({ customData: finalData })
        .where(and(eq(records.id, created.id), eq(records.tenantId, auth.tenantId))).returning()
      await recalculateCalculatedDependents(tx, auth.tenantId, entity.id, null, finalData)
      return { row: final, createdChildren }
    })
    // Mismo enganche que el alta normal: la transacción ya confirmó y un
    // fallo del flujo no revierte los registros ni cambia la respuesta.
    fireTriggersForRecord(auth.tenantId, entity.id, 'on_create', result.row.id, result.row.customData as Record<string, unknown>)
    for (const child of result.createdChildren) {
      fireTriggersForRecord(auth.tenantId, child.entityId, 'on_create', child.id, child.customData)
    }
    setResponseStatus(event, 201)
    return result.row
  } catch (error) {
    if (error instanceof MissingIncrementalPrefixError) throw createError({ statusCode: 422, statusMessage: error.message })
    throw error
  }
})
