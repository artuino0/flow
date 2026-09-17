import { listSeries } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi } from '~/server/utils/cfdiHttp'

// GET /api/facturacion/series — series fiscales del tenant (folio por serie+tipo).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  try {
    return await listSeries(auth.tenantId)
  } catch (err) {
    failCfdi(err)
  }
})
