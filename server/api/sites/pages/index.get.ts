import { z } from 'zod'
import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { listAllSitePages } from '~/server/utils/sites'

const querySchema = z.object({ kind: z.enum(['website', 'landing']).optional() })

export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  const query = await getValidatedQuery(event, querySchema.parse)
  return { pages: await listAllSitePages(auth.tenantId, query.kind) }
})
