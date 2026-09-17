import { z } from 'zod'
import { sendCfdiEmail } from '~/server/utils/cfdi/timbrado'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// POST /api/facturacion/documents/:id/enviar — fase G: manda XML+PDF por el
// SMTP del tenant (mailer.ts / tenant_email_settings). `para` opcional: si no
// viene, usa el correo snapshotado del receptor.
const bodySchema = z.object({
  para: z.string().trim().email('Correo inválido').max(200).optional().nullable()
})

export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  const body = await readBody(event).catch(() => ({}))
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    return await sendCfdiEmail(auth.tenantId, id, parsed.data.para)
  } catch (err) {
    failCfdi(err)
  }
})
