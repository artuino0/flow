import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { InvalidTriggerActionConfigError, TRIGGER_ACTION_TYPES, updateTriggerAction } from '~/server/utils/triggerAdmin'

// PUT /api/trigger-actions/:id { actionType?, config?, executionOrder? } (HU-ERD-51)
// Si se cambia actionType o config, se revalida el PAR completo resultante
// (ver comentario en triggerAdmin.ts, updateTriggerAction()).
const bodySchema = z.object({
  actionType: z.enum(TRIGGER_ACTION_TYPES).optional(),
  config: z.record(z.unknown()).optional(),
  executionOrder: z.number().int().min(0).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  let action
  try {
    action = await updateTriggerAction(auth.tenantId, id, body)
  } catch (err) {
    if (err instanceof InvalidTriggerActionConfigError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }

  if (!action) {
    throw createError({ statusCode: 404, statusMessage: 'Acción no encontrada' })
  }
  return action
})
