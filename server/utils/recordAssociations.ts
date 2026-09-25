import { and, eq, or, sql } from 'drizzle-orm'
import { entityFields, recordRelations, records, relationDefinitions } from '~/server/db/schema'
import { labelFieldFor } from '~/utils/recordLabel'
import type { withTenant } from '~/server/db'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0]

export class DuplicateRecordRelationError extends Error {
  constructor() {
    super('Estos registros ya están asociados')
    this.name = 'DuplicateRecordRelationError'
  }
}

export class RecordRelationValidationError extends Error {
  constructor(message: string, readonly statusCode = 422) {
    super(message)
    this.name = 'RecordRelationValidationError'
  }
}

/** Campo de texto usado como etiqueta legible (configurado en el módulo o el primer texto). */
export async function resolveEntityLabelField(tx: Tx, entityId: string, override?: string | null): Promise<string | null> {
  const fields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType }).from(entityFields)
    .where(eq(entityFields.entityId, entityId)).orderBy(entityFields.sortOrder)
  return labelFieldFor(fields as unknown as EntityFieldMeta[], override)
}

export function recordLabel(customData: unknown, labelField: string | null, id: string, deleted = false): string {
  if (deleted) return 'Registro eliminado'
  const raw = labelField ? (customData as Record<string, unknown> | null)?.[labelField] : null
  return typeof raw === 'string' && raw.trim() ? raw : id.slice(0, 8)
}

/**
 * Crea un vínculo validando existencia, tipo y duplicados. Se serializa por
 * (definición, par de registros) con un advisory lock para que dos peticiones
 * concurrentes no creen el mismo vínculo (o su inverso en relaciones reflexivas);
 * el índice único es la última barrera.
 */
export async function createRecordRelation(tx: Tx, input: {
  tenantId: string
  relationDefinitionId: string
  sourceRecordId: string
  targetRecordId: string
}) {
  const { tenantId, relationDefinitionId, sourceRecordId, targetRecordId } = input
  const [definition] = await tx.select().from(relationDefinitions)
    .where(and(eq(relationDefinitions.id, relationDefinitionId), eq(relationDefinitions.tenantId, tenantId))).limit(1)
  if (!definition) throw new RecordRelationValidationError('La definición de relación no existe', 404)
  const selfRelation = definition.sourceEntityId === definition.targetEntityId
  if (selfRelation && sourceRecordId === targetRecordId) {
    throw new RecordRelationValidationError('Un registro no puede asociarse consigo mismo')
  }

  const pair = [sourceRecordId, targetRecordId].sort().join(':')
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${relationDefinitionId}:${selfRelation ? pair : `${sourceRecordId}:${targetRecordId}`}`}, 0))`)

  const ends = await tx.select({ id: records.id, entityId: records.entityId, deletedAt: records.deletedAt }).from(records)
    .where(and(eq(records.tenantId, tenantId), or(eq(records.id, sourceRecordId), eq(records.id, targetRecordId))))
  const source = ends.find(row => row.id === sourceRecordId)
  const target = ends.find(row => row.id === targetRecordId)
  if (!source || source.entityId !== definition.sourceEntityId || source.deletedAt
    || !target || target.entityId !== definition.targetEntityId || target.deletedAt) {
    throw new RecordRelationValidationError('Uno de los registros no existe, fue eliminado o no corresponde a la relación')
  }

  const sameDirection = and(eq(recordRelations.sourceRecordId, sourceRecordId), eq(recordRelations.targetRecordId, targetRecordId))
  const inverse = and(eq(recordRelations.sourceRecordId, targetRecordId), eq(recordRelations.targetRecordId, sourceRecordId))
  const [existing] = await tx.select({ id: recordRelations.id }).from(recordRelations)
    .where(and(eq(recordRelations.tenantId, tenantId), eq(recordRelations.relationDefinitionId, relationDefinitionId), selfRelation ? or(sameDirection, inverse) : sameDirection))
    .limit(1)
  if (existing) throw new DuplicateRecordRelationError()

  try {
    const [row] = await tx.insert(recordRelations).values({ tenantId, relationDefinitionId, sourceRecordId, targetRecordId }).returning()
    return { definition, row: row! }
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new DuplicateRecordRelationError()
    throw error
  }
}
