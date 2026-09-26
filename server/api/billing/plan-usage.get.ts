import { requireAdminRole } from '~/server/utils/rbac'
import { getPlanUsage } from '~/server/utils/billing'
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return getPlanUsage(auth.tenantId)
})
