import { complementoCreateSchema, generarComplementoDesdeCobro } from '~/server/utils/cfdi/complementoPagos'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// POST /api/facturacion/complementos — fase E: genera el documento P
// (borrador) desde un cobro aplicado del mundo dinámico. Se timbra después
// con POST /api/facturacion/documents/:id/timbrar como cualquier otro.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const body = await readBody(event)
  const parsed = complementoCreateSchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    const row = await generarComplementoDesdeCobro(auth.tenantId, auth.sub ?? null, parsed.data)
    setResponseStatus(event, 201)
    return row
  } catch (err) {
    failCfdi(err)
  }
})
