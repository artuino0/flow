import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { ADMIN_TRIGGER_EVENTS, InvalidTriggerActionConfigError, InvalidTriggerConditionError, updateTrigger } from '~/server/utils/triggerAdmin'
import { assertPlanCapacity } from '~/server/utils/billing'
import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { triggers } from '~/server/db/schema'

// PUT /api/triggers/:id { name?, triggerEvent?, condition?, isActive? } (HU-ERD-51)
// Todos los campos opcionales - este MISMO endpoint es el toggle
// activo/inactivo del listado (mandando solo { isActive }), sin necesitar una
// ruta separada. entityId no es editable (ver comentario largo en
// server/utils/triggerAdmin.ts, updateTrigger()).
const bodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  triggerEvent: z.enum(ADMIN_TRIGGER_EVENTS).optional(),
  condition: z.unknown().optional(),
  decisionCondition: z.unknown().optional(),
  isActive: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)
  if (body.isActive) {
    const [existing] = await withTenant(auth.tenantId, tx => tx.select({ isActive: triggers.isActive }).from(triggers).where(eq(triggers.id, id)).limit(1))
    if (existing && !existing.isActive) await assertPlanCapacity(auth.tenantId, 'activeFlows')
  }

  let trigger
  try {
    trigger = await updateTrigger(auth.tenantId, id, body)
  } catch (err) {
    if (err instanceof InvalidTriggerConditionError || err instanceof InvalidTriggerActionConfigError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }

  if (!trigger) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger no encontrado' })
  }
  return trigger
})
