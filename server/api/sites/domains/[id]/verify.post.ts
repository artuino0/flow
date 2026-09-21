import { requireAdminRole } from '~/server/utils/rbac'
import { verifySiteDomain } from '~/server/utils/siteDomains'
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const domain = await verifySiteDomain(auth.tenantId, getRouterParam(event, 'id')!)
  if (!domain) throw createError({ statusCode: 404, statusMessage: 'Dominio no encontrado' })
  return domain
})