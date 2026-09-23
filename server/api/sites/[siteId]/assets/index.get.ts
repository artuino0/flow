import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listSiteAssets } from '~/server/utils/managedStorage'

export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  return { assets: await listSiteAssets(auth.tenantId, getRouterParam(event, 'siteId')!) }
})
