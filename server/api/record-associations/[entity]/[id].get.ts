import { alias } from 'drizzle-orm/pg-core'
import { and, count, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { entities, entityFields, recordRelations, records, relationDefinitions } from '~/server/db/schema'
import { getPermissionFlags, requirePermission } from '~/server/utils/rbac'
import { recordNotDeleted } from '~/server/utils/records'
import { recordLabel, resolveEntityLabelField } from '~/server/utils/recordAssociations'
import { resolveListLayout } from '~/server/utils/listLayout'
import { resolveRelationLabels } from '~/server/utils/relationLabels'
import { isListFilterable } from '~/utils/listFilters'

// GET /api/record-associations/:entity/:id[?definitionId=&page=]
// Sin definitionId: tipos de asociación (relation_definitions) que involucran el
// módulo y cuyo otro extremo el usuario puede leer. Con definitionId: vínculos
// paginados de este registro con etiquetas legibles. Distinto de los campos
// `relation` inversos que ya muestra RecordDetailView.
const querySchema = z.object({
  definitionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1)
})
const pageSize = 25

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const recordId = getRouterParam(event, 'id')!
  const query = await getValidatedQuery(event, querySchema.parse)
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const [currentRecord] = await withTenant(auth.tenantId, tx => tx.select({ id: records.id }).from(records)
    .where(and(eq(records.id, recordId), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)).limit(1))
  if (!currentRecord) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })

  const sourceEntity = alias(entities, 'association_source_entity')
  const targetEntity = alias(entities, 'association_target_entity')
  const definitions = await withTenant(auth.tenantId, tx => tx.select({
    id: relationDefinitions.id,
    name: relationDefinitions.name,
    sourceEntityId: relationDefinitions.sourceEntityId,
    targetEntityId: relationDefinitions.targetEntityId,
    sourceSlug: sourceEntity.slug,
    targetSlug: targetEntity.slug,
    sourceName: sourceEntity.name,
    targetName: targetEntity.name,
    sourceLabelField: sourceEntity.labelField,
    targetLabelField: targetEntity.labelField,
    sourceListLayout: sourceEntity.listLayout,
    targetListLayout: targetEntity.listLayout,
    sourceDeletedAt: sourceEntity.deletedAt,
    targetDeletedAt: targetEntity.deletedAt
  }).from(relationDefinitions)
    .innerJoin(sourceEntity, eq(sourceEntity.id, relationDefinitions.sourceEntityId))
    .innerJoin(targetEntity, eq(targetEntity.id, relationDefinitions.targetEntityId))
    .where(and(eq(relationDefinitions.tenantId, auth.tenantId), or(eq(relationDefinitions.sourceEntityId, entity.id), eq(relationDefinitions.targetEntityId, entity.id))))
    .orderBy(relationDefinitions.name))

  const ownFlags = await getPermissionFlags(auth, entity.id)
  const flagsByEntity = new Map<string, Awaited<ReturnType<typeof getPermissionFlags>>>()
  const visible = []
  for (const definition of definitions) {
    const side = definition.sourceEntityId === entity.id ? 'source' as const : 'target' as const
    const relatedEntityId = side === 'source' ? definition.targetEntityId : definition.sourceEntityId
    const relatedDeleted = side === 'source' ? definition.targetDeletedAt : definition.sourceDeletedAt
    if (relatedDeleted) continue
    if (!flagsByEntity.has(relatedEntityId)) flagsByEntity.set(relatedEntityId, await getPermissionFlags(auth, relatedEntityId))
    const relatedFlags = flagsByEntity.get(relatedEntityId)!
    if (!relatedFlags.canRead) continue
    visible.push({
      id: definition.id,
      name: definition.name,
      side,
      selfRelation: definition.sourceEntityId === definition.targetEntityId,
      relatedEntityId,
      relatedSlug: side === 'source' ? definition.targetSlug : definition.sourceSlug,
      relatedName: side === 'source' ? definition.targetName : definition.sourceName,
      relatedLabelField: side === 'source' ? definition.targetLabelField : definition.sourceLabelField,
      relatedListLayout: side === 'source' ? definition.targetListLayout : definition.sourceListLayout,
      canLink: ownFlags.canUpdate && relatedFlags.canUpdate
    })
  }

  if (!query.definitionId) return { definitions: visible.map(({ relatedLabelField: _label, relatedListLayout: _layout, ...definition }) => definition) }
  const definition = visible.find(item => item.id === query.definitionId)
  if (!definition) throw createError({ statusCode: 404, statusMessage: 'Asociación no disponible' })

  const linkCondition = definition.selfRelation
    ? or(eq(recordRelations.sourceRecordId, recordId), eq(recordRelations.targetRecordId, recordId))!
    : definition.side === 'source' ? eq(recordRelations.sourceRecordId, recordId) : eq(recordRelations.targetRecordId, recordId)
  // Se une con el registro del otro extremo para ocultar (y no contar) los eliminados.
  const otherRecordId = definition.selfRelation
    ? or(
      and(eq(recordRelations.sourceRecordId, recordId), eq(records.id, recordRelations.targetRecordId)),
      and(eq(recordRelations.targetRecordId, recordId), eq(records.id, recordRelations.sourceRecordId))
    )!
    : eq(records.id, definition.side === 'source' ? recordRelations.targetRecordId : recordRelations.sourceRecordId)
  const where = and(
    eq(recordRelations.tenantId, auth.tenantId),
    eq(recordRelations.relationDefinitionId, definition.id),
    linkCondition,
    eq(records.entityId, definition.relatedEntityId),
    recordNotDeleted
  )
  return withTenant(auth.tenantId, async (tx) => {
    const [totalRow] = await tx.select({ value: count() }).from(recordRelations).innerJoin(records, otherRecordId).where(where)
    const rows = await tx.select({ linkId: recordRelations.id, recordId: records.id, customData: records.customData })
      .from(recordRelations).innerJoin(records, otherRecordId).where(where)
      .orderBy(recordRelations.createdAt, recordRelations.id)
      .limit(pageSize).offset((query.page - 1) * pageSize)
    const labelField = await resolveEntityLabelField(tx, definition.relatedEntityId, definition.relatedLabelField)
    const fields = await tx.select({ name: entityFields.name, label: entityFields.label, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields).where(eq(entityFields.entityId, definition.relatedEntityId)).orderBy(entityFields.sortOrder, entityFields.createdAt)
    // Mismas columnas que el listado del módulo relacionado (máx. 6, sin campos de presentación).
    const layout = resolveListLayout(definition.relatedListLayout, fields.map(f => f.name), fields.filter(f => isListFilterable(f.dataType)).map(f => f.name))
    const presentable = new Set(['file', 'tabla', 'json'])
    const columns = layout.columns.filter(c => c.visible)
      .map(c => fields.find(f => f.name === c.name))
      .filter((f): f is NonNullable<typeof f> => Boolean(f) && !presentable.has(f!.dataType))
      .slice(0, 6)
    const relationLabels = await resolveRelationLabels(tx, auth.tenantId, columns, rows)
    return {
      columns,
      relationLabels,
      data: rows.map(row => ({ id: row.linkId, recordId: row.recordId, label: recordLabel(row.customData, labelField, row.recordId), customData: row.customData })),
      page: query.page,
      pageSize,
      total: totalRow?.value ?? 0
    }
  })
})
