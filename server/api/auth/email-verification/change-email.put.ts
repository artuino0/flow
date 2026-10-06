import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { issueEmailVerification, registrationPerson, VerificationEmailExistsError, VerificationRateLimitError } from '~/server/utils/emailVerification'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

const bodySchema = z.object({ email: z.string().trim().email() })

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const { email } = await readValidatedBody(event, bodySchema.parse)
  const person = await registrationPerson(auth.tenantId, auth.sub)
  await authRequestLimit(event, 'resend', person.id, auth.tenantId)
  try {
    await issueEmailVerification(person.id, auth.tenantId, false, email.trim().toLowerCase())
  } catch (error) {
    if (error instanceof VerificationEmailExistsError) throw createError({ statusCode: 409, statusMessage: error.message })
    if (error instanceof VerificationRateLimitError) throw createError({ statusCode: 429, statusMessage: error.message })
    if (error instanceof SmtpNotConfiguredError) throw createError({ statusCode: 503, statusMessage: error.message })
    throw error
  }
  return { ok: true, delivery: 'queued', retryAfter: 60, email: email.trim().toLowerCase() }
})
