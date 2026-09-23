import { requireAdminRole } from '~/server/utils/rbac'
import { restoreEntity } from '~/server/utils/moduleEntities'

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const entity = await restoreEntity(auth.tenantId, id)
  if (!entity) throw createError({ statusCode: 404, statusMessage: 'Módulo borrado no encontrado' })
  return entity
})
