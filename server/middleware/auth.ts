import { AUTH_COOKIE_NAME, resolveAuthToken, verifyAuthToken } from '~/server/utils/auth'

// Middleware global (HU-ERD-15): valida el JWT de cualquier ruta /api/* salvo
// las publicas, y deja el payload disponible en event.context.auth para que
// los endpoints y requirePermission() no tengan que reverificar el token.
// HU-ERD-22: el token puede venir por header Authorization (clientes API) o
// por la cookie httpOnly que setea /api/auth/login (frontend web).
// HU-ERD-35: /api/config es publica (sin auth) - login.vue la necesita ANTES
// de autenticarse (para saber si mostrar el campo "Organizacion" en modo
// "dedicated"), y el modo/feature flags no son informacion sensible.
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/config'])

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
    event.context.auth = verifyAuthToken(token, config.jwtSecret as string)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado' })
  }
})
