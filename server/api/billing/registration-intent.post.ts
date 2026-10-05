import { requireAdminRole } from '~/server/utils/rbac'
import { clearRegistrationChoice, getRegistrationChoice, saveRegistrationChoice } from '~/server/utils/registrationIntent'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body: unknown = await readBody(event)
  if (body && typeof body === 'object' && 'clear' in body && body.clear === true) await clearRegistrationChoice(auth.tenantId)
  else await saveRegistrationChoice(auth.tenantId, body)
  return getRegistrationChoice(auth.tenantId)
})
