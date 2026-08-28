import { getBearerToken, verifyAuthToken } from '~/server/utils/auth'

// Endpoint protegido de ejemplo (HU-ERD-14): valida el JWT del header
// Authorization: Bearer <token> y devuelve el payload decodificado.
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const token = getBearerToken(getHeader(event, 'authorization'))

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Falta el header Authorization: Bearer <token>' })
  }

  try {
    const payload = verifyAuthToken(token, config.jwtSecret as string)
    return { authenticated: true, ...payload }
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado' })
  }
})
