import { and, eq } from 'drizzle-orm'
import { requirePermissionForEntityId } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { relationDefinitions, recordRelations } from '~/server/db/schema'

// DELETE /api/relations/:id (HU-ERD-19)
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const auth = event.context.auth as { tenantId: string } | undefined
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }

  const existing = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(recordRelations)
      .where(and(eq(recordRelations.id, id), eq(recordRelations.tenantId, auth.tenantId)))
      .limit(1)
    return r
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Relacion no encontrada' })
  }

  const definition = await withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx
      .select()
      .from(relationDefinitions)
      .where(eq(relationDefinitions.id, existing.relationDefinitionId))
      .limit(1)
    return d
  })
  if (!definition) {
    throw createError({ statusCode: 404, statusMessage: 'relation_definition no existe' })
  }

  await requirePermissionForEntityId(event, definition.sourceEntityId, 'canUpdate')
  await requirePermissionForEntityId(event, definition.targetEntityId, 'canUpdate')

  await withTenant(auth.tenantId, (tx) =>
    tx.delete(recordRelations).where(and(eq(recordRelations.id, id), eq(recordRelations.tenantId, auth.tenantId)))
  )

  return { deleted: true, id }
})
