import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listAllSiteForms } from '~/server/utils/sites'

export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  return { forms: await listAllSiteForms(auth.tenantId) }
})
