import { listDocuments, listDocumentsQuerySchema } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// GET /api/facturacion/documents — listado paginado con filtros (tipo, estado,
// serie, rango de fechas, q por receptor/RFC/UUID/folio).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const query = getQuery(event)
  const parsed = listDocumentsQuerySchema.safeParse(query)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    return await listDocuments(auth.tenantId, parsed.data)
  } catch (err) {
    failCfdi(err)
  }
})
