import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const BCRYPT_ROUNDS = 12

// HU-ERD-22: nombre de la cookie httpOnly donde vive el JWT (almacenamiento
// seguro en el navegador: no accesible desde JS, mitiga robo por XSS).
// maxAge en segundos, alineado con el expiresIn del JWT (8h).
export const AUTH_COOKIE_NAME = 'erp_auth_token'
export const AUTH_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export interface AuthTokenPayload {
  sub: string // user id
  tenantId: string
  roleId: string | null
}

export function signAuthToken(payload: AuthTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '8h' })
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload {
  return jwt.verify(token, secret) as AuthTokenPayload
}

export function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  return token
}

/**
 * HU-ERD-22: resuelve el JWT de una request dando prioridad al header
 * Authorization (clientes API/mobile), y si no viene, cae a la cookie
 * httpOnly (frontend web). Funcion pura (sin depender de H3Event) para
 * poder testearla sin levantar un server real.
 */
export function resolveAuthToken(
  authHeader: string | undefined,
  cookieValue: string | undefined
): string | null {
  return getBearerToken(authHeader) ?? cookieValue ?? null
}
