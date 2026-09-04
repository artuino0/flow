import { z } from 'zod'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { verifyPassword, signPendingTotpToken } from '~/server/utils/auth'
import { getAppMode } from '~/server/utils/appConfig'
import { checkLoginRateLimit, clearLoginRateLimit, recordFailedLoginAttempt } from '~/server/utils/rateLimit'
import { findPersonByEmail, resolveLoginResult } from '~/server/utils/peopleAuth'

// Pedido directo del usuario (2026-09-04, HU multi-organizacion): "la
// organizacion en el login no debe pedirse a fuerza en el primer paso...
// siempre y cuando tuviera mas de una organizacion el correo" - ya NO recibe
// tenantId en ningun modo (antes era obligatorio en modo "saas"). El paso 1
// verifica la identidad de la PERSONA (people, global - ver el comentario
// largo en server/db/schema.ts sobre people vs. users) UNA sola vez;
// resolveLoginResult() (server/utils/peopleAuth.ts) decide, recien despues,
// si hay una sola organización (sesión directa, mismo comportamiento de
// siempre) o mas de una (pide elegir - POST /api/auth/login/select-org).
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  // HU-ERD-35: diagnostico de configuracion preservado - un deployment
  // "dedicated" (un solo cliente) con 0 o mas de 1 tenant esta mal armado.
  // Ya no hace falta para RESOLVER el tenant del login (eso ahora lo hace
  // resolveLoginResult() de forma generica para cualquier cantidad de
  // organizaciones - un deployment dedicated, al tener un unico tenant
  // posible, cae solo en el camino "una sola membresia" de mas abajo), pero
  // sigue siendo la unica señal de que el deployment esta mal configurado.
  if (getAppMode() === 'dedicated') {
    const allTenants = await db.select({ id: tenants.id }).from(tenants).limit(2)
    if (allTenants.length !== 1) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Configuracion invalida: modo "dedicated" requiere exactamente un tenant'
      })
    }
  }

  const normalizedEmail = body.email.trim().toLowerCase()

  // HU-ERD-83 (parte 1): el bucket de rate limit ya no puede ser
  // "tenant+email" (el tenant no se conoce en este punto) - pasa a ser
  // global por correo, lo cual de hecho es MAS correcto que antes: un
  // atacante probando contraseñas contra una PERSONA (no contra una
  // membresia puntual) es exactamente el vector que esto mitiga.
  const rateLimitKey = normalizedEmail
  const rateLimitStatus = checkLoginRateLimit(rateLimitKey)
  if (rateLimitStatus.blocked) {
    setResponseHeader(event, 'Retry-After', rateLimitStatus.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: `Demasiados intentos fallidos. Vuelve a intentar en ${Math.ceil(rateLimitStatus.retryAfterSeconds / 60)} minuto(s)`
    })
  }

  const person = await findPersonByEmail(normalizedEmail)
  if (!person) {
    recordFailedLoginAttempt(rateLimitKey)
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const valid = await verifyPassword(body.password, person.passwordHash)
  if (!valid) {
    recordFailedLoginAttempt(rateLimitKey)
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  // HU-ERD-83 (parte 2): 2FA es de la PERSONA (people.totpEnabled), no de
  // una organización puntual - se valida antes de siquiera mirar cuantas
  // organizaciones tiene (login/totp.post.ts es quien llama a
  // resolveLoginResult() despues de un codigo valido).
  if (person.totpEnabled) {
    clearLoginRateLimit(rateLimitKey)
    const tempToken = signPendingTotpToken({ sub: person.id }, config.jwtSecret as string)
    return { ok: true, requiresTotp: true, tempToken }
  }

  clearLoginRateLimit(rateLimitKey)
  return resolveLoginResult(event, person.id, config.jwtSecret as string)
})
