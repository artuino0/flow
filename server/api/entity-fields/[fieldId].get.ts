import { requireAdminRole } from '~/server/utils/rbac'
import { getEntityFieldImpact } from '~/server/utils/moduleEntityFields'

// GET /api/entity-fields/:fieldId (HU-ERD-76)
// Sibling de [fieldId].put.ts/[fieldId].delete.ts (HU-ERD-67, mismo recurso
// plano) - devuelve el campo junto con `affectedRecords` (cuantos records de
// su entidad ya tienen una clave para el en custom_data), usado por el modal
// de advertencia antes de confirmar una edicion/borrado riesgosos. Solo
// Administrador (requireAdminRole), igual que PUT/DELETE.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const fieldId = getRouterParam(event, 'fieldId')!

  const impact = await getEntityFieldImpact(auth.tenantId, fieldId)
  if (!impact) {
    throw createError({ statusCode: 404, statusMessage: 'Campo no encontrado' })
  }
  return impact
})
