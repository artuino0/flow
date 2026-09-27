import { requireAdminRole } from '~/server/utils/rbac'
import { getEntityRecord, restoreEntity } from '~/server/utils/moduleEntities'
import { assertPlanCapacity } from '~/server/utils/billing'

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  // HU-ERD-104c: restaurar un módulo vuelve a meterlo al conteo de 'modules'
  // del plan (getPlanUsage cuenta module_kind <> 'dimension' AND deleted_at IS
  // NULL) - si ya está al tope, bloquear con el mismo 402 'plan_limit' que el
  // POST /api/entities. Los catálogos (dimension) no consumen cuota. Solo se
  // revisa cuando el módulo existe y está borrado: si no, restoreEntity sigue
  // devolviendo null y el 404 de siempre queda intacto.
  const existing = await getEntityRecord(auth.tenantId, id)
  if (existing?.deletedAt && existing.moduleKind !== 'dimension') await assertPlanCapacity(auth.tenantId, 'modules')
  const entity = await restoreEntity(auth.tenantId, id)
  if (!entity) throw createError({ statusCode: 404, statusMessage: 'Módulo borrado no encontrado' })
  return entity
})
