import fs from 'node:fs'
import { loadCfdiBinary } from '~/server/utils/cfdi/timbrado'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// GET /api/facturacion/documents/:id/pdf — descarga de la representación
// impresa (PDF) que genera el PAC junto al timbrado.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  const binary = loadCfdiBinary(auth.tenantId, id, 'pdf')
  if (!binary) throw createError({ statusCode: 404, statusMessage: 'El PDF timbrado no existe en disco' })
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${binary.fileName}"`)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  return sendStream(event, fs.createReadStream(binary.fullPath))
})
