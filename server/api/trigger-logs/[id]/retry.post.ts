import { requireAdminRole } from '~/server/utils/rbac'
import { retryTriggerLogManually, TriggerLogNotFoundError } from '~/server/utils/triggerAdmin'

// POST /api/trigger-logs/:id/retry (HU-ERD-51) - boton "reintentar" manual de
// la vista de auditoria. Unico archivo bajo /api/trigger-logs/:id/* (no hay
// GET/PUT/DELETE terminando exactamente en /api/trigger-logs/:id) - sin
// riesgo de mezclar profundidades (ver comentario en
// server/utils/moduleEntityFields.ts).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  try {
    const log = await retryTriggerLogManually(auth.tenantId, id)
    return log
  } catch (err) {
    if (err instanceof TriggerLogNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
