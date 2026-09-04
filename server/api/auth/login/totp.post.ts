import { z } from 'zod'
import { verifyPendingTotpToken } from '~/server/utils/auth'
import { verifyTotpCode } from '~/server/utils/totp'
import { checkLoginRateLimit, clearLoginRateLimit, recordFailedLoginAttempt } from '~/server/utils/rateLimit'
import { findPersonById, resolveLoginResult } from '~/server/utils/peopleAuth'

// POST /api/auth/login/totp (HU-ERD-83 parte 2): segundo paso del login
// cuando la persona tiene 2FA activo - recibe el `tempToken` de 5 min
// devuelto por POST /api/auth/login junto con el codigo de 6 digitos de la
// app autenticadora. Publico (no pasa por el middleware de auth.ts - no hay
// sesion previa en este punto, ver server/middleware/auth.ts).
//
// HU multi-organizacion (2026-09-04): `tempToken` ya no trae tenantId (ver
// el comentario largo en server/utils/auth.ts) - un codigo valido llama a
// resolveLoginResult() igual que login.post.ts sin 2FA, para recien ahi
// decidir sesion directa vs. elegir organización.
const bodySchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  let pending: { sub: string }
  try {
    pending = verifyPendingTotpToken(body.tempToken, config.jwtSecret as string)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado, volve a iniciar sesion' })
  }

  const person = await findPersonById(pending.sub)
  if (!person || !person.totpEnabled || !person.totpSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  // Bucket propio (prefijo "totp:"), separado del de intentos de contraseña -
  // un codigo TOTP mal tipeado no deberia bloquear tambien el login por
  // contraseña de la misma cuenta, y viceversa.
  const rateLimitKey = `totp:${person.email}`
  const rateLimitStatus = checkLoginRateLimit(rateLimitKey)
  if (rateLimitStatus.blocked) {
    setResponseHeader(event, 'Retry-After', rateLimitStatus.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: `Demasiados intentos fallidos. Vuelve a intentar en ${Math.ceil(rateLimitStatus.retryAfterSeconds / 60)} minuto(s)`
    })
  }

  const valid = await verifyTotpCode(person.totpSecret, body.code)
  if (!valid) {
    recordFailedLoginAttempt(rateLimitKey)
    throw createError({ statusCode: 401, statusMessage: 'Codigo invalido' })
  }

  clearLoginRateLimit(rateLimitKey)
  return resolveLoginResult(event, person.id, config.jwtSecret as string)
})
