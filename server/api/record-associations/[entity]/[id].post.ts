import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { relationDefinitions } from '~/server/db/schema'
import { requirePermission, requirePermissionForEntityId } from '~/server/utils/rbac'
import { createRecordRelation, DuplicateRecordRelationError, RecordRelationValidationError } from '~/server/utils/recordAssociations'
import { assertVisibleRecords } from '~/server/utils/visibleRecords'

// POST /api/record-associations/:entity/:id { definitionId, relatedRecordId }
// El registro de la ficha es el origen o el destino según el lado del módulo en
// la definición; en relaciones reflexivas es el origen.
const bodySchema = z.object({
  definitionId: z.string().uuid(),
  relatedRecordId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const recordId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')

  const [definition] = await withTenant(auth.tenantId, tx => tx.select().from(relationDefinitions)
    .where(and(eq(relationDefinitions.id, body.definitionId), eq(relationDefinitions.tenantId, auth.tenantId))).limit(1))
  if (!definition || (definition.sourceEntityId !== entity.id && definition.targetEntityId !== entity.id)) {
    throw createError({ statusCode: 404, statusMessage: 'Asociación no disponible' })
  }
  const side = definition.sourceEntityId === entity.id ? 'source' : 'target'
  const relatedEntityId = side === 'source' ? definition.targetEntityId : definition.sourceEntityId
  await requirePermissionForEntityId(event, relatedEntityId, 'canRead')
  await requirePermissionForEntityId(event, relatedEntityId, 'canUpdate')

  try {
    const { row } = await withTenant(auth.tenantId, async tx => {
      await assertVisibleRecords(tx, auth.tenantId, [recordId, body.relatedRecordId])
      return createRecordRelation(tx, {
      tenantId: auth.tenantId,
      relationDefinitionId: definition.id,
      sourceRecordId: side === 'source' ? recordId : body.relatedRecordId,
      targetRecordId: side === 'source' ? body.relatedRecordId : recordId
      })
    })
    setResponseStatus(event, 201)
    return row
  } catch (error) {
    if (error instanceof DuplicateRecordRelationError) throw createError({ statusCode: 409, statusMessage: error.message })
    if (error instanceof RecordRelationValidationError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    throw error
  }
})
