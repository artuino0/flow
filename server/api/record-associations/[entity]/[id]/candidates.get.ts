import { and, eq, ne, notExists, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { entities, recordRelations, records, relationDefinitions } from '~/server/db/schema'
import { requirePermission, requirePermissionForEntityId } from '~/server/utils/rbac'
import { recordNotDeleted } from '~/server/utils/records'
import { recordLabel, resolveEntityLabelField } from '~/server/utils/recordAssociations'
import { assertVisibleRecords } from '~/server/utils/visibleRecords'

// GET /api/record-associations/:entity/:id/candidates?definitionId=&search=
// Registros del otro módulo que aún pueden asociarse (excluye eliminados, el
// propio registro en relaciones reflexivas y los ya vinculados).
const querySchema = z.object({
  definitionId: z.string().uuid(),
  search: z.string().trim().max(200).optional()
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const recordId = getRouterParam(event, 'id')!
  const query = await getValidatedQuery(event, querySchema.parse)
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')

  const [definition] = await withTenant(auth.tenantId, tx => tx.select({
    id: relationDefinitions.id,
    sourceEntityId: relationDefinitions.sourceEntityId,
    targetEntityId: relationDefinitions.targetEntityId
  }).from(relationDefinitions)
    .where(and(eq(relationDefinitions.id, query.definitionId), eq(relationDefinitions.tenantId, auth.tenantId))).limit(1))
  if (!definition || (definition.sourceEntityId !== entity.id && definition.targetEntityId !== entity.id)) {
    throw createError({ statusCode: 404, statusMessage: 'Asociación no disponible' })
  }
  const side = definition.sourceEntityId === entity.id ? 'source' : 'target'
  const selfRelation = definition.sourceEntityId === definition.targetEntityId
  const relatedEntityId = side === 'source' ? definition.targetEntityId : definition.sourceEntityId
  await requirePermissionForEntityId(event, relatedEntityId, 'canRead')
  await requirePermissionForEntityId(event, relatedEntityId, 'canUpdate')

  return withTenant(auth.tenantId, async (tx) => {
    await assertVisibleRecords(tx, auth.tenantId, [recordId])
    const [related] = await tx.select({ labelField: entities.labelField, deletedAt: entities.deletedAt }).from(entities)
      .where(and(eq(entities.id, relatedEntityId), eq(entities.tenantId, auth.tenantId))).limit(1)
    if (!related || related.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Módulo relacionado no disponible' })
    const labelField = await resolveEntityLabelField(tx, relatedEntityId, related.labelField)

    const linkedToCurrent = selfRelation
      ? or(
        and(eq(recordRelations.sourceRecordId, recordId), eq(recordRelations.targetRecordId, records.id)),
        and(eq(recordRelations.targetRecordId, recordId), eq(recordRelations.sourceRecordId, records.id))
      )!
      : side === 'source'
        ? and(eq(recordRelations.sourceRecordId, recordId), eq(recordRelations.targetRecordId, records.id))!
        : and(eq(recordRelations.targetRecordId, recordId), eq(recordRelations.sourceRecordId, records.id))!
    const conditions = [
      eq(records.tenantId, auth.tenantId),
      eq(records.entityId, relatedEntityId),
      recordNotDeleted,
      notExists(tx.select({ one: sql`1` }).from(recordRelations)
        .where(and(eq(recordRelations.relationDefinitionId, definition.id), linkedToCurrent)))
    ]
    if (selfRelation) conditions.push(ne(records.id, recordId))
    if (query.search) {
      const term = `%${query.search.replace(/[\%_]/g, char => `\${char}`)}%`
      // Se busca en todo el registro (no solo en la etiqueta): el usuario puede
      // teclear el nombre aunque la etiqueta configurada sea un código o folio.
      conditions.push(sql`${records.customData}::text ilike ${term}`)
    }
    const rows = await tx.select({ id: records.id, customData: records.customData }).from(records)
      .where(and(...conditions)).orderBy(records.createdAt).limit(20)
    return { data: rows.map(row => ({ id: row.id, label: recordLabel(row.customData, labelField, row.id) })) }
  })
})
