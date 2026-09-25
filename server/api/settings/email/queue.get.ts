import { requireAdminRole } from '~/server/utils/rbac'
import { summarizeQueue } from '~/server/utils/jobQueue'

// GET /api/settings/email/queue - estado de la cola de correo de la organización:
// cuántos hay pendientes, enviados o fallidos, y los últimos 50 con su error.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  return summarizeQueue(auth.tenantId)
})
