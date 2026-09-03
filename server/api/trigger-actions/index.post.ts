import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createTriggerAction, InvalidTriggerActionConfigError, TRIGGER_ACTION_TYPES, TriggerNotFoundError } from '~/server/utils/triggerAdmin'

// POST /api/trigger-actions { triggerId, actionType, config, executionOrder? } (HU-ERD-51)
// Recurso PLANO (no anidado bajo /api/triggers/:id/) a proposito - ver el
// comentario largo en server/utils/moduleEntityFields.ts sobre el bug real
// de enrutamiento de Nitro/rou3 al mezclar, bajo el mismo prefijo, una ruta
// que TERMINA en :id (GET/PUT/DELETE /api/triggers/:id) con otra que
// CONTINUA con mas segmentos (.../actions) - mismo criterio que llevo a
// /api/entity-fields/:fieldId a ser un recurso plano en vez de anidado bajo
// /api/entities/:entity/fields/:fieldId.
const bodySchema = z.object({
  triggerId: z.string().uuid(),
  actionType: z.enum(TRIGGER_ACTION_TYPES),
  config: z.record(z.unknown()),
  executionOrder: z.number().int().min(0).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const { triggerId, ...input } = body

  try {
    const action = await createTriggerAction(auth.tenantId, triggerId, input)
    setResponseStatus(event, 201)
    return action
  } catch (err) {
    if (err instanceof TriggerNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof InvalidTriggerActionConfigError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
