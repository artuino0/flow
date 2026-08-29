import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenants, users } from '~/server/db/schema'
import { AUTH_COOKIE_MAX_AGE_SECONDS, AUTH_COOKIE_NAME, verifyPassword, signAuthToken } from '~/server/utils/auth'

// MVP: el cliente indica el tenant explicitamente (tenantId). Cuando exista
// resolucion por subdominio/dominio (multi-tenant SaaS), este endpoint debe
// resolver el tenant a partir del host en vez de confiar en el body.
const bodySchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  // HU-ERD-61: tenants ahora existe como tabla propia (antes tenant_id era
  // un UUID suelto sin fila asociada). Mismo error generico que credenciales
  // invalidas si no existe, para no revelar si el UUID es real o no.
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, body.tenantId)).limit(1)
  if (!tenant) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const user = await withTenant(body.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, body.tenantId), eq(users.email, body.email)))
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
