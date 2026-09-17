import { getDocumentDetail } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi } from '~/server/utils/cfdiHttp'

// GET /api/facturacion/documents/:id — documento + serie + conceptos +
// DoctoRelacionados (tipo P) + CFDI relacionado (tipo E) + línea de tiempo
// de cfdi_events. xmlStorageKey/pdfStorageKey NO salen (rutas internas de
// disco, patrón logoStorageKey de ERD-62): los binarios se descargan por
// GET :id/xml y :id/pdf.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  try {
    const detail = await getDocumentDetail(auth.tenantId, id)
    const { xmlStorageKey, pdfStorageKey, ...documento } = detail.documento
    return { ...detail, documento: { ...documento, hasXml: xmlStorageKey != null, hasPdf: pdfStorageKey != null } }
  } catch (err) {
    failCfdi(err)
  }
})
