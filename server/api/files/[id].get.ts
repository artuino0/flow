import fs from 'node:fs'
import { requireAuth, getPermissionFlags } from '~/server/utils/rbac'
import { getFile } from '~/server/utils/fileStorage'

// GET /api/files/:id (HU-ERD-78) - descarga/visualiza un archivo. Requiere
// canRead sobre la entidad a la que se subio el archivo (file.entityId) -
// mismo criterio de permiso que leer cualquier record de esa entidad.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')!

  const file = await getFile(auth.tenantId, id)
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  }

  const perms = await getPermissionFlags(auth, file.entityId)
  if (!perms.canRead) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para ver este archivo' })
  }

  if (!fs.existsSync(file.fullPath)) {
    throw createError({ statusCode: 404, statusMessage: 'El archivo ya no existe en disco' })
  }

  setResponseHeader(event, 'Content-Type', file.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`)
  return sendStream(event, fs.createReadStream(file.fullPath))
})
