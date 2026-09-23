import { StoredObjectNotFoundError } from '~/server/utils/objectStorage'
import { requireAuth, getPermissionFlags } from '~/server/utils/rbac'
import { getManagedFile, readManagedFile } from '~/server/utils/managedStorage'

// GET /api/files/:id (HU-ERD-78) - descarga/visualiza un archivo. Requiere
// canRead sobre la entidad a la que se subio el archivo (file.entityId) -
// mismo criterio de permiso que leer cualquier record de esa entidad.
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

  setResponseHeader(event, 'Content-Type', file.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`)
  try { return await readManagedFile(file.storageKey) } catch (error) {
    if (error instanceof StoredObjectNotFoundError) throw createError({ statusCode: 404, statusMessage: 'El archivo ya no existe en almacenamiento' })
    throw error
  }
})
