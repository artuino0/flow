import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listSites } from '~/server/utils/sites'
export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  return { sites: await listSites(auth.tenantId) }
})
