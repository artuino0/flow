import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { assertVerificationDelivery, issueEmailVerification, registrationPerson, VerificationEmailExistsError, VerificationRateLimitError } from '~/server/utils/emailVerification'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

const bodySchema = z.object({ email: z.string().trim().email() })

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const { email } = await readValidatedBody(event, bodySchema.parse)
  const person = await registrationPerson(auth.tenantId, auth.sub)
  try {
    await assertVerificationDelivery(auth.tenantId)
    await issueEmailVerification(person.id, auth.tenantId, true, email.trim().toLowerCase())
  } catch (error) {
    if (error instanceof VerificationEmailExistsError) throw createError({ statusCode: 409, statusMessage: error.message })
    if (error instanceof VerificationRateLimitError) throw createError({ statusCode: 429, statusMessage: error.message })
    if (error instanceof SmtpNotConfiguredError) throw createError({ statusCode: 503, statusMessage: error.message })
    throw error
  }
  return { ok: true, email: email.trim().toLowerCase() }
})
