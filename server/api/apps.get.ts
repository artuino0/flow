import { requireAuth } from '~/server/utils/rbac'
import { listAvailableFlowApps } from '~/server/utils/flowCapabilities'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  return listAvailableFlowApps(auth.tenantId, auth.sub)
})

