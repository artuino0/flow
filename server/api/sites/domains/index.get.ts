import { z } from 'zod'
import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listSiteDomains } from '~/server/utils/siteDomains'
const querySchema = z.object({ siteId: z.string().uuid().optional() })
export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  const query = await getValidatedQuery(event, querySchema.parse)
  return { domains: await listSiteDomains(auth.tenantId, query.siteId) }
})