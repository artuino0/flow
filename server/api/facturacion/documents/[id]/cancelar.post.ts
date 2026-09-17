import { z } from 'zod'
import { getPacProvider } from '~/server/utils/pac/provider'
import { cancelDocument } from '~/server/utils/cfdi/timbrado'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// POST /api/facturacion/documents/:id/cancelar — fase F (cancelación SAT).
// El motivo 01 exige el UUID del comprobante sustituto, que debe existir y
// estar timbrado en el mismo tenant (validado en cancelDocument).
const bodySchema = z.object({
  motivo: z.enum(['01', '02', '03', '04']),
  folioSustitucion: z
    .string()
    .trim()
    .uuid('El folio sustituto debe ser un UUID fiscal')
    .optional()
    .nullable()
})

export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    const provider = await getPacProvider(auth.tenantId)
    return await cancelDocument(auth.tenantId, id, auth.sub ?? null, provider, {
      motivo: parsed.data.motivo,
      folioSustitucion: parsed.data.folioSustitucion ?? null
    })
  } catch (err) {
    failCfdi(err)
  }
})
