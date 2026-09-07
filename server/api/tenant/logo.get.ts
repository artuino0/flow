import fs from 'node:fs'
import { requireAuth } from '~/server/utils/rbac'
import { getTenantLogo } from '~/server/utils/tenantLogo'

// GET /api/tenant/logo (ERD-62) - sirve el logo actual del tenant. A
// diferencia de POST/DELETE (admin-gated), esto solo pide requireAuth: lo
// necesita CUALQUIER usuario del tenant que genere un reporte imprimible
// (Zone Encabezado, PrintReportSheet.vue), no solo un administrador - un
// logo no es un dato sensible, y bloquearlo por rol solo rompe la vista
// previa para el resto del equipo.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

  const logo = await getTenantLogo(auth.tenantId)
  if (!logo) {
    throw createError({ statusCode: 404, statusMessage: 'Este tenant todavia no tiene un logo cargado' })
  }
  if (!fs.existsSync(logo.fullPath)) {
    throw createError({ statusCode: 404, statusMessage: 'El logo ya no existe en disco' })
  }

  setResponseHeader(event, 'Content-Type', logo.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${logo.fileName.replace(/"/g, '')}"`)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  return sendStream(event, fs.createReadStream(logo.fullPath))
})
