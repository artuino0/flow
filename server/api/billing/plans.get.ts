import { requireAdminRole } from '~/server/utils/rbac'
import { getAvailablePlansForTenant } from '~/server/utils/billing'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return { plans: await getAvailablePlansForTenant(auth.tenantId) }
})
