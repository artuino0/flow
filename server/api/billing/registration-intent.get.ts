import { requireAdminRole } from '~/server/utils/rbac'
import { getRegistrationChoice } from '~/server/utils/registrationIntent'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return getRegistrationChoice(auth.tenantId)
})
