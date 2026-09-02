import { AUTH_COOKIE_NAME, resolveAuthToken, verifyAuthToken } from '~/server/utils/auth'

// Middleware global (HU-ERD-15): valida el JWT de cualquier ruta /api/* salvo
// las publicas, y deja el payload disponible en event.context.auth para que
// los endpoints y requirePermission() no tengan que reverificar el token.
// HU-ERD-22: el token puede venir por header Authorization (clientes API) o
// por la cookie httpOnly que setea /api/auth/login (frontend web).
// HU-ERD-35: /api/config es publica (sin auth) - login.vue la necesita ANTES
// de autenticarse (para saber si mostrar el campo "Organizacion" en modo
// "dedicated"), y el modo/feature flags no son informacion sensible.
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/login/totp',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/config',
  // HU-ERD-84: aceptar una invitacion pasa el token en el body (no una
  // sesion) - el invitado todavia no tiene cuenta activa para autenticarse.
  '/api/users/accept-invitation'
])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  if (!path.startsWith('/api/') || PUBLIC_PATHS.has(path)) {
    return
  }

  const config = useRuntimeConfig()
  const token = resolveAuthToken(getHeader(event, 'authorization'), getCookie(event, AUTH_COOKIE_NAME))

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado (falta token)' })
  }

  try {
    const payload = verifyAuthToken(token, config.jwtSecret as string)
    // HU-ERD-83 (parte 2): un token "totp-pending" (server/utils/auth.ts) se
    // firma con el MISMO secreto que una sesion real - sin este chequeo,
    // pasaria `verifyAuthToken` sin problema y quedaria disponible como
    // sesion valida en cualquier endpoint autenticado durante su ventana de
    // 5 minutos, sin haber completado el segundo factor todavia. Solo sirve
    // para POST /api/auth/login/totp (que lo verifica el mismo, no pasa por
    // este middleware porque no requiere sesion previa).
    if ((payload as unknown as { purpose?: string }).purpose === 'totp-pending') {
      throw new Error('Token pendiente de 2FA, no es una sesion valida')
    }
    event.context.auth = payload
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado' })
  }
})
