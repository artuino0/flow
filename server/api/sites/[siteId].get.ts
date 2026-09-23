import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { getSite } from '~/server/utils/sites'
export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  const site = await getSite(auth.tenantId, getRouterParam(event, 'siteId')!)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
  return site
})
