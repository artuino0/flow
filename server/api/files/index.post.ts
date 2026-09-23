import { z } from 'zod'
import { requireAuth, getPermissionFlags } from '~/server/utils/rbac'
import { ManagedFileTooLargeError, storeManagedFile } from '~/server/utils/managedStorage'

// POST /api/files?entityId=... (HU-ERD-78, multipart/form-data, un archivo)
// Sube el archivo para el dataType 'file' - entityId es la entidad DESTINO
// (no un record: el record puede no existir todavia, ver comentario largo en
// server/db/schema.ts). Requiere canCreate O canUpdate sobre esa entidad -
// cubre tanto el formulario de alta (canCreate) como el de edicion
// (canUpdate) sin necesitar dos endpoints.
const querySchema = z.object({ entityId: z.string().uuid() })

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  const perms = await getPermissionFlags(auth, query.entityId)
  if (!perms.canCreate && !perms.canUpdate) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para subir archivos a esta entidad' })
  }

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find((p) => p.filename)
  if (!filePart || !filePart.filename) {
    throw createError({ statusCode: 422, statusMessage: 'No se recibio ningun archivo' })
  }

  try {
    const stored = await storeManagedFile(auth.tenantId, query.entityId, {
      fileName: filePart.filename,
      mimeType: filePart.type ?? 'application/octet-stream',
      buffer: filePart.data,
      uploadedBy: auth.sub
    })
    setResponseStatus(event, 201)
    return stored
  } catch (err) {
    if (err instanceof ManagedFileTooLargeError) {
      throw createError({ statusCode: 413, statusMessage: err.message })
    }
    throw err
  }
})
