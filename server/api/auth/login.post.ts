import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenants, users } from '~/server/db/schema'
import { verifyPassword, signPendingTotpToken, issueSessionCookies } from '~/server/utils/auth'
import { getAppMode } from '~/server/utils/appConfig'
import { checkLoginRateLimit, clearLoginRateLimit, recordFailedLoginAttempt } from '~/server/utils/rateLimit'

// MVP (modo "saas"): el cliente indica el tenant explicitamente (tenantId).
// Cuando exista resolucion por subdominio/dominio, este endpoint deberia
// resolver el tenant a partir del host en vez de confiar en el body.
//
// HU-ERD-35: en modo "dedicated" (un solo cliente por deployment, APP_MODE)
// tenantId es opcional - se ignora si viene, y se resuelve server-side el
// unico tenant que deberia existir (ver mas abajo). pages/login.vue ya no
// pide el campo "Organizacion" en ese modo.
const bodySchema = z.object({
  tenantId: z.string().uuid().optional(),
  email: z.string().email(),
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  let tenantId: string
  if (getAppMode() === 'dedicated') {
    // Error de configuracion del deployment (0 o >1 tenants), no de
    // credenciales del usuario - se distingue del 401 generico de abajo
    // porque nunca deberia pasar en un deployment "dedicated" bien armado y,
    // si pasa, hace falta que sea diagnosticable (no "credenciales invalidas").
    const allTenants = await db.select({ id: tenants.id }).from(tenants).limit(2)
    if (allTenants.length !== 1) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Configuracion invalida: modo "dedicated" requiere exactamente un tenant'
      })
    }
    tenantId = allTenants[0].id
  } else {
    if (!body.tenantId) {
      throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
    }
    tenantId = body.tenantId
  }

  // HU-ERD-61: tenants ahora existe como tabla propia (antes tenant_id era
  // un UUID suelto sin fila asociada). Mismo error generico que credenciales
  // invalidas si no existe, para no revelar si el UUID es real o no.
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!tenant) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  // HU-ERD-83 (parte 1): limite de intentos fallidos por cuenta (tenant+email),
  // no por IP - el vector que importa aca es "alguien probando contraseñas
  // contra ESTA cuenta puntual" (fuerza bruta/credential stuffing), no cuanto
  // trafico general manda una IP. Se chequea ANTES de tocar la base/bcrypt
  // (mas barato) y se registra el intento SOLO si termina en credenciales
  // invalidas (ver mas abajo) - un usuario legitimo que loguea bien nunca
  // acumula intentos.
  const rateLimitKey = `${tenantId}:${body.email.toLowerCase()}`
  const rateLimitStatus = checkLoginRateLimit(rateLimitKey)
  if (rateLimitStatus.blocked) {
    setResponseHeader(event, 'Retry-After', rateLimitStatus.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: `Demasiados intentos fallidos. Vuelve a intentar en ${Math.ceil(rateLimitStatus.retryAfterSeconds / 60)} minuto(s)`
    })
  }

  const user = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, body.email)))
      .limit(1)
    return rows[0] ?? null
  })

  if (!user || !user.isActive) {
    recordFailedLoginAttempt(rateLimitKey)
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) {
    recordFailedLoginAttempt(rateLimitKey)
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  // HU-ERD-83 (parte 2): si el usuario tiene 2FA activo, la contraseña
  // correcta NO alcanza para abrir sesion - se emite un token intermedio de
  // 5 min (nunca en cookie, el cliente lo guarda solo en memoria durante el
  // paso 2) y el login recien se completa (issueSessionCookies) en
  // POST /api/auth/login/totp con un codigo TOTP valido. El rate limit ya se
  // limpio arriba porque la CONTRASEÑA fue correcta - un codigo TOTP
  // incorrecto despues se limita aparte (ver login/totp.post.ts), no
  // comparte contador con intentos de contraseña.
  if (user.totpEnabled) {
    clearLoginRateLimit(rateLimitKey)
    const tempToken = signPendingTotpToken({ sub: user.id, tenantId: user.tenantId }, config.jwtSecret as string)
    return { ok: true, requiresTotp: true, tempToken }
  }

  clearLoginRateLimit(rateLimitKey)

  // HU-ERD-22/83: almacenamiento seguro del JWT - cookies httpOnly (no
  // accesibles desde JS, mitiga robo por XSS), no se devuelve ningun token
  // crudo en el body.
  issueSessionCookies(event, { sub: user.id, tenantId: user.tenantId, roleId: user.roleId }, config.jwtSecret as string)

  return { ok: true, requiresTotp: false }
})
