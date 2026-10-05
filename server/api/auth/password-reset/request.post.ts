import { z } from 'zod'
import { clientIp } from '~/server/utils/clientIp'
import { requestPasswordReset } from '~/server/utils/passwordReset'
import { checkPasswordResetRateLimit, recordPasswordResetAttempt } from '~/server/utils/rateLimit'
import { logger } from '~/server/utils/logger'

const schema = z.object({ email: z.string().email().max(320) })
const MESSAGE = 'Si el correo existe, te enviaremos un enlace para restablecer tu contraseña.'

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const body = await readValidatedBody(event, schema.parse)
  const emailKey = `password-reset:email:${body.email.trim().toLowerCase()}`
  const ipKey = `password-reset:ip:${clientIp(event)}`
  const emailLimit = checkPasswordResetRateLimit(emailKey)
  const ipLimit = checkPasswordResetRateLimit(ipKey)
  if (emailLimit.blocked || ipLimit.blocked) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt))))
    return { ok: true, message: MESSAGE }
  }
  recordPasswordResetAttempt(emailKey)
  recordPasswordResetAttempt(ipKey)
  try {
    await requestPasswordReset(body.email)
  } catch {
    logger.error('password_reset_request_failed')
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt))))
  return { ok: true, message: MESSAGE }
})
