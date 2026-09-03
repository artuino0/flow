import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { InvalidTriggerActionOrderError, reorderTriggerActions, TriggerNotFoundError } from '~/server/utils/triggerAdmin'

// PUT /api/trigger-actions/reorder { triggerId, order: actionId[] } (HU-ERD-51)
// Recurso plano ESTATICO ("reorder" no es un uuid), sibling de
// /api/trigger-actions/:id - mismo patron ya probado en
// /api/entity-fields/reorder.put.ts (HU-ERD-76): ambos al mismo nivel bajo
// el mismo prefijo, sin el riesgo de mezclar profundidades distintas
// documentado en server/utils/moduleEntityFields.ts.
const bodySchema = z.object({
  triggerId: z.string().uuid(),
  order: z.array(z.string().uuid()).min(1)
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const actions = await reorderTriggerActions(auth.tenantId, body.triggerId, body.order)
    return { actions }
  } catch (err) {
    if (err instanceof TriggerNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof InvalidTriggerActionOrderError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
