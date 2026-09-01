import { requireAdminRole } from '~/server/utils/rbac'
import { deleteRelationDefinition } from '~/server/utils/relationDefinitions'

// DELETE /api/relation-definitions/:id (HU-ERD-77)
// Nunca borra vinculos ya creados en cascada: si la definicion tiene
// record_relations, responde 409 con el conteo (mismo criterio que
// DELETE /api/entities/:id, ver moduleEntities.ts).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  const result = await deleteRelationDefinition(auth.tenantId, id)

  if (result.status === 'not-found') {
    throw createError({ statusCode: 404, statusMessage: 'Relacion no encontrada' })
  }
  if (result.status === 'has-links') {
    throw createError({
      statusCode: 409,
      statusMessage: `No se puede eliminar: esta relacion ya tiene ${result.linkCount} vinculo${result.linkCount === 1 ? '' : 's'} creado${result.linkCount === 1 ? '' : 's'}`
    })
  }

  return { deleted: true, id }
})
