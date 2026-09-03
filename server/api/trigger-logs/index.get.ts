import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { listTriggerLogs, TriggerNotFoundError } from '~/server/utils/triggerAdmin'

// GET /api/trigger-logs?triggerId=...&limit=... (HU-ERD-51)
// `triggerId` es OBLIGATORIO (a diferencia de entityId en /api/triggers) -
// la vista de auditoria siempre es "las ultimas ejecuciones DE este trigger",
// nunca un listado global de todo el tenant (que mezclaria triggers de
// distintas entidades sin mucho sentido en una sola tabla).
const querySchema = z.object({
  triggerId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  try {
    return await listTriggerLogs(auth.tenantId, query.triggerId, query.limit)
  } catch (err) {
    if (err instanceof TriggerNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
