import { requireAuth } from '~/server/utils/rbac'
import { issueEmailVerification, registrationPerson, VerificationRateLimitError } from '~/server/utils/emailVerification'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const person = await registrationPerson(auth.tenantId, auth.sub)
  await authRequestLimit(event, 'resend', person.id, auth.tenantId)
  try {
    await issueEmailVerification(person.id, auth.tenantId)
  } catch (error) {
    if (error instanceof VerificationRateLimitError) throw createError({ statusCode: 429, statusMessage: error.message })
    if (error instanceof SmtpNotConfiguredError) throw createError({ statusCode: 503, statusMessage: error.message })
    throw error
  }
  return { ok: true, delivery: 'queued', retryAfter: 60 }
})
