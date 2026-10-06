import { requireAuth } from '~/server/utils/rbac'
import { registrationPerson, verificationStatus } from '~/server/utils/emailVerification'
export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const person = await registrationPerson(auth.tenantId, auth.sub)
  return verificationStatus(person.id, auth.tenantId)
})
