import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenants, users } from '~/server/db/schema'
import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME, verifyPassword, signAuthToken } from '~/server/utils/auth'
import { getAppMode } from '~/server/utils/appConfig'

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

  const user = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, body.email)))
      .limit(1)
    return rows[0] ?? null
  })

  if (!user || !user.isActive) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const token = signAuthToken(
    { sub: user.id, tenantId: user.tenantId, roleId: user.roleId },
    config.jwtSecret as string
  )

  // HU-ERD-22: almacenamiento seguro del JWT - cookie httpOnly (no accesible
  // desde JS, mitiga robo por XSS), no se devuelve el token crudo en el body.
  setCookie(event, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  })

  return { ok: true }
})
