import { requireAdminRole } from '~/server/utils/rbac'
import { listPublicPlans } from '~/server/utils/billing'

export default defineEventHandler(async event => {
  await requireAdminRole(event)
  return { plans: await listPublicPlans() }
})
