import { z } from 'zod'
import { requireFlowCapability } from '~/server/utils/flowCapabilities'
import { getSiteDomainProvider, listSiteDomains } from '~/server/utils/siteDomains'
const querySchema = z.object({ siteId: z.string().uuid().optional() })
export default defineEventHandler(async event => {
  const { auth } = await requireFlowCapability(event, 'sites.access')
  const query = await getValidatedQuery(event, querySchema.parse)
  let providerConfigured = false
  try { providerConfigured = getSiteDomainProvider().configured } catch { /* La interfaz explica la configuración pendiente. */ }
  return { domains: await listSiteDomains(auth.tenantId, query.siteId), providerConfigured }
})
