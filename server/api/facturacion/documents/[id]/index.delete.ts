import { deleteDocument } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi } from '~/server/utils/cfdiHttp'

// DELETE /api/facturacion/documents/:id — solo borradores que nunca
// consumieron folio. Todo lo demás se cancela ante el SAT (fase F), jamás se
// borra: la secuencia de folios es historia fiscal.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  try {
    await deleteDocument(auth.tenantId, id)
    return { ok: true }
  } catch (err) {
    failCfdi(err)
  }
})
