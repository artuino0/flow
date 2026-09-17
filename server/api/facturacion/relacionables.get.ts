import { listTimbradasParaRelacionar } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi } from '~/server/utils/cfdiHttp'

// GET /api/facturacion/relacionables — facturas tipo I timbradas, para el
// selector "CFDI relacionado" de las notas de crédito (tipo E) y para el
// folio sustituto de la cancelación motivo 01.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  try {
    return await listTimbradasParaRelacionar(auth.tenantId)
  } catch (err) {
    failCfdi(err)
  }
})
