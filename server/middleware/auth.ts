import { getBearerToken, verifyAuthToken } from '~/server/utils/auth'

// Middleware global (HU-ERD-15): valida el JWT de cualquier ruta /api/* salvo
// las publicas, y deja el payload disponible en event.context.auth para que
// los endpoints y requirePermission() no tengan que reverificar el token.
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login'])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  if (!path.startsWith('/api/') || PUBLIC_PATHS.has(path)) {
    return
  }

  const config = useRuntimeConfig()
  const token = getBearerToken(getHeader(event, 'authorization'))

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Falta el header Authorization: Bearer <token>' })
  }

  try {
    event.context.auth = verifyAuthToken(token, config.jwtSecret as string)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado' })
  }
})
