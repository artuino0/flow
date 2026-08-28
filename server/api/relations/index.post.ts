import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requirePermissionForEntityId } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { relationDefinitions, recordRelations } from '~/server/db/schema'

// POST /api/relations { relationDefinitionId, sourceRecordId, targetRecordId } (HU-ERD-19)
// La integridad (que ambos records existan y sean del tipo de entidad esperado
// por la relation_definition) la valida el trigger fn_validate_record_relation (ERD-10);
// aca solo validamos forma + RBAC antes de intentar el insert.
const bodySchema = z.object({
  relationDefinitionId: z.string().uuid(),
  sourceRecordId: z.string().uuid(),
  targetRecordId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const auth = event.context.auth as { tenantId: string } | undefined
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }

  const definition = await withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx
      .select()
      .from(relationDefinitions)
      .where(and(eq(relationDefinitions.id, body.relationDefinitionId), eq(relationDefinitions.tenantId, auth.tenantId)))
      .limit(1)
    return d
  })
  if (!definition) {
    throw createError({ statusCode: 404, statusMessage: 'relation_definition no existe' })
  }

  // Crear un vinculo es una edicion sobre ambos records que participan en el.
  await requirePermissionForEntityId(event, definition.sourceEntityId, 'canUpdate')
  await requirePermissionForEntityId(event, definition.targetEntityId, 'canUpdate')

  try {
    const row = await withTenant(auth.tenantId, async (tx) => {
      const [r] = await tx
        .insert(recordRelations)
        .values({
          tenantId: auth.tenantId,
          relationDefinitionId: body.relationDefinitionId,
          sourceRecordId: body.sourceRecordId,
          targetRecordId: body.targetRecordId
        })
        .returning()
      return r
    })
    setResponseStatus(event, 201)
    return row
  } catch (err) {
    // El trigger de integridad (ERD-10) rechaza con RAISE EXCEPTION si el
    // record no existe o no es del tipo esperado; se traduce a 422 en vez
    // de dejar pasar un 500 crudo de Postgres.
    const message = err instanceof Error ? err.message : 'No se pudo crear la relacion'
    throw createError({ statusCode: 422, statusMessage: message })
  }
})
