import { requireAdminRole } from '~/server/utils/rbac'
import { getSiteSeoAudit } from '~/server/utils/siteSeoAudit'
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const result = await getSiteSeoAudit(auth.tenantId, getRouterParam(event, 'siteId')!)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
  return result
})
