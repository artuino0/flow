import { z } from 'zod'
import { and, eq, desc } from 'drizzle-orm'
import { requirePermissionForEntityId } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { relationDefinitions, recordRelations } from '~/server/db/schema'

// GET /api/relations?relationDefinitionId=...&sourceRecordId=...&targetRecordId=...&page=1&pageSize=20 (HU-ERD-19)
const querySchema = z.object({
  relationDefinitionId: z.string().uuid(),
  sourceRecordId: z.string().uuid().optional(),
  targetRecordId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, querySchema.parse)
  const auth = event.context.auth as { tenantId: string } | undefined
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }

  const definition = await withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx
      .select()
      .from(relationDefinitions)
      .where(and(eq(relationDefinitions.id, query.relationDefinitionId), eq(relationDefinitions.tenantId, auth.tenantId)))
      .limit(1)
    return d
  })
  if (!definition) {
    throw createError({ statusCode: 404, statusMessage: 'relation_definition no existe' })
  }

  // Leer relaciones de este tipo requiere poder leer ambas entidades que vincula.
  await requirePermissionForEntityId(event, definition.sourceEntityId, 'canRead')
  await requirePermissionForEntityId(event, definition.targetEntityId, 'canRead')

  const offset = (query.page - 1) * query.pageSize
  return withTenant(auth.tenantId, async (tx) => {
    const conditions = [
      eq(recordRelations.tenantId, auth.tenantId),
      eq(recordRelations.relationDefinitionId, query.relationDefinitionId)
    ]
    if (query.sourceRecordId) conditions.push(eq(recordRelations.sourceRecordId, query.sourceRecordId))
    if (query.targetRecordId) conditions.push(eq(recordRelations.targetRecordId, query.targetRecordId))

    const data = await tx
      .select()
      .from(recordRelations)
      .where(and(...conditions))
      .orderBy(desc(recordRelations.createdAt))
      .limit(query.pageSize)
      .offset(offset)

    return { data, page: query.page, pageSize: query.pageSize }
  })
})
