import fs from 'node:fs'
import { loadCfdiBinary } from '~/server/utils/cfdi/timbrado'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// GET /api/facturacion/documents/:id/xml — descarga del XML timbrado
// (archivo {documentId}.xml; el nombre "bonito" serie-folio-uuid lo arma el
// correo de la fase G, ver sendCfdiEmail).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  const binary = loadCfdiBinary(auth.tenantId, id, 'xml')
  if (!binary) throw createError({ statusCode: 404, statusMessage: 'El XML timbrado no existe en disco' })
  setResponseHeader(event, 'Content-Type', 'application/xml')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${binary.fileName}"`)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  return sendStream(event, fs.createReadStream(binary.fullPath))
})
