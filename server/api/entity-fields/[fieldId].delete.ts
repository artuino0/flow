import { requireAdminRole } from '~/server/utils/rbac'
import { deleteEntityField } from '~/server/utils/moduleEntityFields'

// DELETE /api/entity-fields/:fieldId (HU-ERD-67)
// Recurso plano - ver el comentario largo en server/utils/moduleEntityFields.ts
// (mismo motivo que [fieldId].put.ts, sibling de este archivo).
//
// A diferencia de DELETE /api/entities/:id (ERD-66, bloqueado 409 si hay
// records), esto nunca se bloquea por datos existentes - los records que
// tenian una clave para este campo en custom_data quedan con una clave
// huerfana en el JSON (no se borra nada de records), que se limpia sola en
// la proxima revalidacion perezosa (is_dirty, ERD-18).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const fieldId = getRouterParam(event, 'fieldId')!

  const result = await deleteEntityField(auth.tenantId, fieldId)
  if (result === 'not-found') {
    throw createError({ statusCode: 404, statusMessage: 'Campo no encontrado' })
  }
  return { deleted: true, id: fieldId }
})
