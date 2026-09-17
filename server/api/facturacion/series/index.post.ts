import { createSerie, serieCreateSchema } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// POST /api/facturacion/series — alta de serie fiscal (letra + tipo de
// comprobante + lugar de expedición). El folio arranca en 1 y se consume
// atómicamente al timbrar (cfdiFolio.ts).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const body = await readBody(event)
  const parsed = serieCreateSchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    const row = await createSerie(auth.tenantId, parsed.data)
    setResponseStatus(event, 201)
    return row
  } catch (err) {
    failCfdi(err)
  }
})
