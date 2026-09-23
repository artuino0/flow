import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listSitePublications } from '~/server/utils/sites'

export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  return { publications: await listSitePublications(auth.tenantId, getRouterParam(event, 'siteId')!) }
})
