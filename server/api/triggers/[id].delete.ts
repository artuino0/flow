import { requireAdminRole } from '~/server/utils/rbac'
import { deleteTrigger } from '~/server/utils/triggerAdmin'

// DELETE /api/triggers/:id (HU-ERD-51) - borra el trigger y, en cascada real
// a nivel de base (ERD-47), sus trigger_actions y trigger_logs. Sin bloqueo
// de "tiene ejecuciones" (a diferencia de relation-definitions con sus
// record_relations): trigger_logs es historial de auditoria, no dato de
// negocio a proteger, ver comentario en triggerAdmin.ts (deleteTrigger).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  const deleted = await deleteTrigger(auth.tenantId, id)
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger no encontrado' })
  }
  return { deleted: true, id }
})
