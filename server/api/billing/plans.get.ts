import { requireAdminRole } from '~/server/utils/rbac'
import { withAccountRecovery } from '~/server/utils/accountContext'
import { getAvailablePlansForTenant } from '~/server/utils/billing'
import { getRegistrationChoice, registrationEvent } from '~/server/utils/registrationIntent'

export default defineEventHandler(event => withAccountRecovery(async () => {
  const auth = await requireAdminRole(event)
  const choice = await getRegistrationChoice(auth.tenantId)
  if (choice.intent) registrationEvent('plan_preselected', choice.intent)
  return { plans: await getAvailablePlansForTenant(auth.tenantId), ...choice }
}))
