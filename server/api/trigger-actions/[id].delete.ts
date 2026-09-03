import { requireAdminRole } from '~/server/utils/rbac'
import { deleteTriggerAction } from '~/server/utils/triggerAdmin'

// DELETE /api/trigger-actions/:id (HU-ERD-51)
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  const deleted = await deleteTriggerAction(auth.tenantId, id)
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Acción no encontrada' })
  }
  return { deleted: true, id }
})
