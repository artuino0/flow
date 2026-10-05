import { z } from 'zod'
import { clientIp } from '~/server/utils/clientIp'
import { passwordPolicySchema } from '~/server/utils/passwordPolicy'
import { confirmPasswordReset, passwordResetRateKey } from '~/server/utils/passwordReset'
import { checkPasswordResetRateLimit, recordPasswordResetAttempt } from '~/server/utils/rateLimit'

const schema = z.object({ token: z.string().min(1).max(128), password: passwordPolicySchema })

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, schema.parse)
  const ipKey = `password-reset-confirm:ip:${clientIp(event)}`
  const ipLimit = checkPasswordResetRateLimit(ipKey)
  if (ipLimit.blocked) throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos. Solicita un enlace nuevo más tarde.' })
  const emailKey = `password-reset-confirm:email:${await passwordResetRateKey(body.token)}`
  const emailLimit = checkPasswordResetRateLimit(emailKey)
  if (emailLimit.blocked) throw createError({ statusCode: 429, statusMessage: 'Demasiados intentos. Solicita un enlace nuevo más tarde.' })
  recordPasswordResetAttempt(ipKey)
  recordPasswordResetAttempt(emailKey)
  const ok = await confirmPasswordReset(body.token, body.password)
  if (!ok) throw createError({ statusCode: 400, statusMessage: 'El enlace es inválido, venció o ya fue utilizado. Solicita uno nuevo.' })
  return { ok: true }
})
