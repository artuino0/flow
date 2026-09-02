import { requireAuth, getPermissionFlags } from '~/server/utils/rbac'
import { getFile, deleteFile } from '~/server/utils/fileStorage'

// DELETE /api/files/:id (HU-ERD-78) - requiere canUpdate sobre la entidad
// del archivo (quitar un adjunto es una edicion, mismo criterio que
// modificar cualquier otro campo de un record de esa entidad).
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')!

  const file = await getFile(auth.tenantId, id)
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  }

  const perms = await getPermissionFlags(auth, file.entityId)
  if (!perms.canUpdate) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para eliminar este archivo' })
  }

  await deleteFile(auth.tenantId, id)
  return { deleted: true, id }
})
