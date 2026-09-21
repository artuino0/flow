import { requireAdminRole } from '~/server/utils/rbac'
import { deleteSiteDomain } from '~/server/utils/siteDomains'
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const deleted = await deleteSiteDomain(auth.tenantId, getRouterParam(event, 'id')!)
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Dominio no encontrado' })
  setResponseStatus(event, 204)
  return null
})