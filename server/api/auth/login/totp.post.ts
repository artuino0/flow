import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { verifyPendingTotpToken, issueSessionCookies } from '~/server/utils/auth'
import { verifyTotpCode } from '~/server/utils/totp'
import { checkLoginRateLimit, clearLoginRateLimit, recordFailedLoginAttempt } from '~/server/utils/rateLimit'

// POST /api/auth/login/totp (HU-ERD-83 parte 2): segundo paso del login
// cuando el usuario tiene 2FA activo - recibe el `tempToken` de 5 min
// devuelto por POST /api/auth/login (ver el comentario ahi) junto con el
// codigo de 6 digitos de la app autenticadora, y si es valido recien ahi
// emite la sesion real (issueSessionCookies). Publico (no pasa por el
// middleware de auth.ts - no hay sesion previa en este punto, ver
// server/middleware/auth.ts).
const bodySchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  let pending: { sub: string; tenantId: string }
  try {
    pending = verifyPendingTotpToken(body.tempToken, config.jwtSecret as string)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado, volve a iniciar sesion' })
  }

  const user = await withTenant(pending.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, pending.sub), eq(users.tenantId, pending.tenantId)))
      .limit(1)
    return row ?? null
  })

  if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  // Bucket propio (prefijo "totp:"), separado del de intentos de contraseña -
  // un codigo TOTP mal tipeado no deberia bloquear tambien el login por
  // contraseña de la misma cuenta, y viceversa.
  const rateLimitKey = `totp:${pending.tenantId}:${user.email.toLowerCase()}`
  const rateLimitStatus = checkLoginRateLimit(rateLimitKey)
  if (rateLimitStatus.blocked) {
    setResponseHeader(event, 'Retry-After', rateLimitStatus.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: `Demasiados intentos fallidos. Vuelve a intentar en ${Math.ceil(rateLimitStatus.retryAfterSeconds / 60)} minuto(s)`
    })
  }

  const valid = await verifyTotpCode(user.totpSecret, body.code)
  if (!valid) {
    recordFailedLoginAttempt(rateLimitKey)
    throw createError({ statusCode: 401, statusMessage: 'Codigo invalido' })
  }

  clearLoginRateLimit(rateLimitKey)
  issueSessionCookies(event, { sub: user.id, tenantId: user.tenantId, roleId: user.roleId }, config.jwtSecret as string)

  return { ok: true }
})
