import { eq, and } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { REFRESH_COOKIE_NAME, verifyRefreshToken, issueSessionCookies } from '~/server/utils/auth'

// POST /api/auth/refresh (HU-ERD-83 parte 2): renueva el access token (15
// min) usando el refresh token (7 dias, cookie separada erp_refresh_token) -
// asi una sesion activa nunca fuerza un re-login mientras el usuario siga
// usando la app (ver composables/useIdleTimeout.ts, que llama aca cada vez
// que hay actividad reciente, y al confirmar el modal de inactividad).
// Publico (no pasa por el middleware de auth.ts, ver PUBLIC_PATHS ahi) - se
// autentica leyendo la cookie de refresh directamente, no un access token.
//
// Rota AMBAS cookies en cada llamada (no solo el access token) - practica
// estandar de refresh token rotation, aunque sin blacklist server-side el
// refresh token viejo tecnicamente seguiria siendo valido hasta su propia
// expiracion si alguien lo hubiera copiado antes de la rotacion (limite
// conocido, documentado en detalle en server/utils/auth.ts).
export default defineEventHandler(async (event) => {
  const refreshToken = getCookie(event, REFRESH_COOKIE_NAME)
  if (!refreshToken) {
    throw createError({ statusCode: 401, statusMessage: 'No hay sesion para renovar' })
  }

  const config = useRuntimeConfig()
  let pending: { sub: string; tenantId: string }
  try {
    pending = verifyRefreshToken(refreshToken, config.jwtSecret as string)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Sesion expirada, volve a iniciar sesion' })
  }

  const user = await withTenant(pending.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: users.id, tenantId: users.tenantId, roleId: users.roleId, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, pending.sub), eq(users.tenantId, pending.tenantId)))
      .limit(1)
    return row ?? null
  })

  if (!user || !user.isActive) {
    throw createError({ statusCode: 401, statusMessage: 'Sesion invalida' })
  }

  issueSessionCookies(event, { sub: user.id, tenantId: user.tenantId, roleId: user.roleId }, config.jwtSecret as string)

  return { ok: true }
})
