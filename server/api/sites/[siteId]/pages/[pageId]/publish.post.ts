import { requireAdminRole } from '~/server/utils/rbac'
import { publishSitePage } from '~/server/utils/sites'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const page = await publishSitePage(auth.tenantId, auth.sub, getRouterParam(event, 'siteId')!, getRouterParam(event, 'pageId')!)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Página o borrador no encontrado' })
  return page
})
