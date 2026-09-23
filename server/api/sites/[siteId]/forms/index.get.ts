import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listSiteForms } from '~/server/utils/sites'

export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  const siteId = getRouterParam(event, 'siteId')!
  return { forms: await listSiteForms(auth.tenantId, siteId) }
})
