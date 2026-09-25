import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { retryDeadJob } from '~/server/utils/jobQueue'

// POST /api/settings/email/queue/:id/retry - vuelve a encolar un correo fallido
// (por ejemplo, después de corregir la configuración de correo).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const requeued = await retryDeadJob(auth.tenantId, id)
  if (!requeued) throw createError({ statusCode: 404, statusMessage: 'No hay un correo fallido con ese id' })
  return { ok: true }
})
