import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { ADMIN_TRIGGER_EVENTS, InvalidTriggerConditionError, updateTrigger } from '~/server/utils/triggerAdmin'

// PUT /api/triggers/:id { name?, triggerEvent?, condition?, isActive? } (HU-ERD-51)
// Todos los campos opcionales - este MISMO endpoint es el toggle
// activo/inactivo del listado (mandando solo { isActive }), sin necesitar una
// ruta separada. entityId no es editable (ver comentario largo en
// server/utils/triggerAdmin.ts, updateTrigger()).
const bodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  triggerEvent: z.enum(ADMIN_TRIGGER_EVENTS).optional(),
  condition: z.unknown().optional(),
  isActive: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  let trigger
  try {
    trigger = await updateTrigger(auth.tenantId, id, body)
  } catch (err) {
    if (err instanceof InvalidTriggerConditionError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }

  if (!trigger) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger no encontrado' })
  }
  return trigger
})
