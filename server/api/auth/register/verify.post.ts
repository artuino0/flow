import { z } from 'zod'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'
import { WITNESS_COOKIE, challengeCookie, registrationCookie, verifyProvisionalRegistration, registrationTokenHash } from '~/server/utils/provisionalRegistration'
export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, z.object({ code: z.string().regex(/^\d{6}$/) }).parse)
  const challenge = challengeCookie(event)
  await authRequestLimit(event, 'otp', registrationTokenHash(challenge))
  const witness = await verifyProvisionalRegistration(challenge, body.code)
  registrationCookie(event, WITNESS_COOKIE, witness, 30 * 60)
  return { ok: true }
})
