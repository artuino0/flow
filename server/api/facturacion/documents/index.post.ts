import { createDocument, documentoCreateSchema } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// POST /api/facturacion/documents — crea un documento fiscal en borrador
// (tipo I factura o E nota de crédito; los P nacen solo de
// POST /api/facturacion/complementos desde un cobro aplicado). Los totales e
// impuestos los calcula el servidor desde los conceptos — el cliente nunca
// declara el total.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const body = await readBody(event)
  const parsed = documentoCreateSchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    const row = await createDocument(auth.tenantId, auth.sub ?? null, parsed.data)
    setResponseStatus(event, 201)
    return row
  } catch (err) {
    failCfdi(err)
  }
})
