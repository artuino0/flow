import { z } from 'zod'
import { getAppMode } from '~/server/utils/appConfig'
import { passwordPolicySchema } from '~/server/utils/passwordPolicy'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'
import { CHALLENGE_COOKIE, WITNESS_COOKIE, challengeCookie, registrationCookie, startProvisionalRegistration, publicRegistrationOperation } from '~/server/utils/provisionalRegistration'
const schema = z.object({ fullName: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email(), password: passwordPolicySchema, registrationChoice: z.unknown().optional() })
export default defineEventHandler(async event => {
  if (getAppMode() === 'dedicated') throw createError({ statusCode: 403, statusMessage: 'Este deployment no acepta registro de nuevas organizaciones' })
  const body = await readValidatedBody(event, schema.parse)
  await authRequestLimit(event, 'registration-emission', body.email)
  const result = await publicRegistrationOperation(() => startProvisionalRegistration(body, challengeCookie(event)))
  registrationCookie(event, CHALLENGE_COOKIE, result.token, 7 * 86400)
  registrationCookie(event, WITNESS_COOKIE, '', 0)
  return { ok: true, retryAfter: result.retryAfter, delivery: result.delivery }
})
