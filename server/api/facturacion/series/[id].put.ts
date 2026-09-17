import { z } from 'zod'
import { setSerieEstado } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// PUT /api/facturacion/series/:id — activar/inactivar serie. No se borran:
// una serie con folios consumidos es historia fiscal del tenant.
const bodySchema = z.object({ estado: z.enum(['activa', 'inactiva']) })

export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id de la serie' })
  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    return await setSerieEstado(auth.tenantId, id, parsed.data.estado)
  } catch (err) {
    failCfdi(err)
  }
})
