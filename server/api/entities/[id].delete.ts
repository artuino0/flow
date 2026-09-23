import { requireAdminRole } from '~/server/utils/rbac'
import { deleteEntity } from '~/server/utils/moduleEntities'

// DELETE /api/entities/:id (HU-ERD-66)
// Deshabilita el módulo y lo conserva en la papelera con todos sus datos.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  const result = await deleteEntity(auth.tenantId, id)

  if (result.status === 'not-found') {
    throw createError({ statusCode: 404, statusMessage: 'Modulo no encontrado' })
  }
  return { deleted: true, id }
})
