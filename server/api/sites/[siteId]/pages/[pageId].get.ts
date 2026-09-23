import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { getSitePage } from '~/server/utils/sites'
export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  const page = await getSitePage(auth.tenantId, getRouterParam(event, 'siteId')!, getRouterParam(event, 'pageId')!)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Página no encontrada' })
  return page
})
