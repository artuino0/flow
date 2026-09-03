import { requireAdminRole } from '~/server/utils/rbac'
import { getTrigger } from '~/server/utils/triggerAdmin'

// GET /api/triggers/:id (HU-ERD-51) - detalle completo para el editor,
// incluye las acciones ya ordenadas por execution_order (evita un segundo
// viaje solo para pintar la lista de acciones).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  const trigger = await getTrigger(auth.tenantId, id)
  if (!trigger) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger no encontrado' })
  }
  return trigger
})
