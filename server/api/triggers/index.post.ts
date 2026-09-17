import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { ADMIN_TRIGGER_EVENTS, createTrigger, InvalidTriggerConditionError, TriggerEntityNotFoundError } from '~/server/utils/triggerAdmin'

// POST /api/triggers { entityId, name, triggerEvent, condition? } (HU-ERD-51)
// Crea un trigger "en blanco" (isActive: false, sin acciones todavia - se
// agregan aparte via POST /api/trigger-actions). `condition` es opcional:
// sin ella queda {} (sin configurar todavia, ver triggerAdmin.ts) - el
// constructor visual del frontend puede terminar de armarla despues con un
// PUT.
const bodySchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  triggerEvent: z.enum(ADMIN_TRIGGER_EVENTS),
  condition: z.unknown().optional(),
  decisionCondition: z.unknown().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const trigger = await createTrigger(auth.tenantId, body)
    setResponseStatus(event, 201)
    return trigger
  } catch (err) {
    if (err instanceof TriggerEntityNotFoundError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    if (err instanceof InvalidTriggerConditionError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
