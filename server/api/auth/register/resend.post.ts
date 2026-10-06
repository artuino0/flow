import { authRequestLimit } from '~/server/utils/authPersistentLimit'
import { WITNESS_COOKIE, challengeCookie, registrationCookie, resendProvisionalRegistration, provisionalRegistrationStatus, witnessCookie } from '~/server/utils/provisionalRegistration'
export default defineEventHandler(async event => {
  const challenge = challengeCookie(event)
  const status = await provisionalRegistrationStatus(challenge, witnessCookie(event))
  if (!status.pending) throw createError({ statusCode: 401, statusMessage: 'Inicia tu registro de nuevo.' })
  await authRequestLimit(event, 'registration-emission', status.email)
  const result = await resendProvisionalRegistration(challenge)
  registrationCookie(event, WITNESS_COOKIE, '', 0)
  return result
})
