import { requireAdminRole } from '~/server/utils/rbac'
import { deleteEntity } from '~/server/utils/moduleEntities'

// DELETE /api/entities/:id (HU-ERD-66)
// Elimina un modulo (entity). Nunca borra datos del usuario: si tiene records
// existentes, responde 409 con el conteo en vez de borrar en cascada.
// entity_fields y role_entity_permissions SI son ON DELETE CASCADE
// (metadatos, no datos - ver moduleEntities.ts).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  const result = await deleteEntity(auth.tenantId, id)

  if (result.status === 'not-found') {
    throw createError({ statusCode: 404, statusMessage: 'Modulo no encontrado' })
  }
  if (result.status === 'has-records') {
    throw createError({
      statusCode: 409,
      statusMessage: `No se puede eliminar: el modulo tiene ${result.recordCount} registro${result.recordCount === 1 ? '' : 's'} existente${result.recordCount === 1 ? '' : 's'}`
    })
  }

  return { deleted: true, id }
})
