import { requireAdminRole } from '~/server/utils/rbac'
import { storeTenantLogo, LogoTooLargeError, LogoInvalidTypeError } from '~/server/utils/tenantLogo'

// POST /api/tenant/logo (ERD-62, multipart/form-data, un archivo) - pedido
// directo del usuario (2026-09-07: "los ajustes para cargar el logo y los
// datos de la empresa emisora del reporte"). Admin-gated, igual que el resto
// de Configuracion General (GET/PUT /api/tenant, HU-ERD-61) - ver el
// comentario grande en server/utils/tenantLogo.ts sobre por que esto NO pasa
// por server/utils/fileStorage.ts/la tabla files.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find((p) => p.filename)
  if (!filePart || !filePart.filename) {
    throw createError({ statusCode: 422, statusMessage: 'No se recibio ningun archivo' })
  }

  try {
    const meta = await storeTenantLogo(auth.tenantId, {
      fileName: filePart.filename,
      mimeType: filePart.type ?? 'application/octet-stream',
      buffer: filePart.data
    })
    setResponseStatus(event, 201)
    return meta
  } catch (err) {
    if (err instanceof LogoTooLargeError) {
      throw createError({ statusCode: 413, statusMessage: err.message })
    }
    if (err instanceof LogoInvalidTypeError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
