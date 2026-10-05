import { requireAdminRole } from '~/server/utils/rbac'
import { setPrimarySiteDomain } from '~/server/utils/siteSeoPublic'
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const domain = await setPrimarySiteDomain(auth.tenantId, getRouterParam(event, 'id')!)
  if (!domain) throw createError({ statusCode: 404, statusMessage: 'Dominio no encontrado' })
  return domain
})
