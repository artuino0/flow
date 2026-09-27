import { requireAdminRole } from '~/server/utils/rbac'
import { aiCreditBalance } from '~/server/utils/moduleDesigner/credits'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return aiCreditBalance(auth.tenantId)
})
