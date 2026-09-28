import { requireAuth } from '~/server/utils/rbac'
import { assertVerificationDelivery, issueEmailVerification, registrationPerson, VerificationRateLimitError } from '~/server/utils/emailVerification'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const person = await registrationPerson(auth.tenantId, auth.sub)
  try {
    await assertVerificationDelivery(auth.tenantId)
    await issueEmailVerification(person.id, auth.tenantId)
  } catch (error) {
    if (error instanceof VerificationRateLimitError) throw createError({ statusCode: 429, statusMessage: error.message })
    if (error instanceof SmtpNotConfiguredError) throw createError({ statusCode: 503, statusMessage: error.message })
    throw error
  }
  return { ok: true }
})
