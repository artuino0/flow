import { requireAuth, getPermissionFlags } from '~/server/utils/rbac'
import { getManagedFile } from '~/server/utils/managedStorage'

// GET /api/files/:id/meta (HU-ERD-78) - metadata JSON del archivo (nombre,
// tipo, tamaño), separado de GET /api/files/:id (que devuelve el binario) -
// lo usa components/DynamicFileField.vue para mostrar el nombre/tamaño de un
// archivo ya subido sin tener que descargarlo. Mismo criterio de permiso
// (canRead sobre la entidad del archivo) que la descarga.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')!

  const file = await getManagedFile(auth.tenantId, id)
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  }

  const perms = await getPermissionFlags(auth, file.entityId)
  if (!perms.canRead) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para ver este archivo' })
  }

  return { id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt }
})
