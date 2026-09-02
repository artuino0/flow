import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { H3Event } from 'h3'

const BCRYPT_ROUNDS = 12

// HU-ERD-22: nombre de la cookie httpOnly donde vive el JWT de acceso
// (almacenamiento seguro en el navegador: no accesible desde JS, mitiga robo
// por XSS). maxAge en segundos, alineado con el expiresIn del JWT.
//
// HU-ERD-83 (parte 2): el access token bajo de 8h a 15 min - de por si solo,
// una sesion de 8h sin ningun mecanismo de refresh es una ventana larga para
// un token robado. Con refresh token (mas abajo) la duracion corta deja de
// ser un costo para el usuario activo (se renueva solo, ver
// composables/useIdleTimeout.ts) y sigue siendo una ventana chica para un
// token de acceso robado sin el refresh token que lo acompaña.
export const AUTH_COOKIE_NAME = 'erp_auth_token'
const ACCESS_TOKEN_EXPIRES_IN = '15m'
export const AUTH_COOKIE_MAX_AGE_SECONDS = 15 * 60

// HU-ERD-83 (parte 2): refresh token de vida larga, en su PROPIA cookie
// httpOnly (nunca se manda por header Authorization, solo cookie - un
// cliente API/mobile que use el header en vez de cookie simplemente no tiene
// refresh, vuelve a loguear cuando el access token de 15 min expira, mismo
// comportamiento que antes de esta HU). Firmado con el mismo secreto que el
// access token pero con `purpose: 'refresh'` para que nunca pueda usarse
// como sesion valida si se manda por error a un endpoint protegido comun
// (server/middleware/auth.ts lo rechaza explicitamente, mismo criterio que
// con el token totp-pending). Limite conocido: es un JWT stateless, no hay
// tabla de sesiones - no hay forma de revocar un refresh token individual
// antes de su expiracion natural (ej. "cerrar sesion en todos los
// dispositivos") salvo rotar el JWT_SECRET global, que invalida TODAS las
// sesiones de TODOS los usuarios. Aceptable para esta entrega; una tabla de
// sesiones con revocacion individual queda fuera de alcance.
export const REFRESH_COOKIE_NAME = 'erp_refresh_token'
const REFRESH_TOKEN_EXPIRES_IN = '7d'
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

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
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_EXPIRES_IN })
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload {
  return jwt.verify(token, secret) as AuthTokenPayload
}

interface RefreshTokenPayload {
  sub: string
  tenantId: string
  purpose: 'refresh'
}

export function signRefreshToken(payload: { sub: string; tenantId: string }, secret: string): string {
  return jwt.sign({ ...payload, purpose: 'refresh' }, secret, { expiresIn: REFRESH_TOKEN_EXPIRES_IN })
}

export function verifyRefreshToken(token: string, secret: string): { sub: string; tenantId: string } {
  const decoded = jwt.verify(token, secret) as RefreshTokenPayload
  if (decoded.purpose !== 'refresh') {
    throw new Error('Token no es de tipo refresh')
  }
  return { sub: decoded.sub, tenantId: decoded.tenantId }
}

/**
 * Emite el par de cookies httpOnly de una sesion (access + refresh) para
 * `payload`. Usado por login.post.ts (login sin 2FA), login/totp.post.ts
 * (segundo paso del login con 2FA) y refresh.post.ts (rotacion) - los tres
 * puntos donde arranca o se renueva una sesion real, para no repetir las
 * opciones de cookie (httpOnly/sameSite/secure/path) tres veces.
 */
export function issueSessionCookies(event: H3Event, payload: AuthTokenPayload, secret: string): void {
  const accessToken = signAuthToken(payload, secret)
  const refreshToken = signRefreshToken({ sub: payload.sub, tenantId: payload.tenantId }, secret)

  const commonOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  }

  setCookie(event, AUTH_COOKIE_NAME, accessToken, { ...commonOptions, maxAge: AUTH_COOKIE_MAX_AGE_SECONDS })
  setCookie(event, REFRESH_COOKIE_NAME, refreshToken, { ...commonOptions, maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS })
}

// HU-ERD-83 (parte 2): token intermedio de vida corta para el segundo paso
// del login cuando el usuario tiene 2FA activo. Se emite en vez de la cookie
// de sesion real apenas la contraseña es valida - el cliente lo guarda solo
// en memoria (nunca en cookie) y lo reenvia junto al codigo TOTP a
// POST /api/auth/login/totp. `purpose` lo distingue de un AuthTokenPayload
// real para que nunca pueda colarse como sesion valida si alguien lo manda
// a un endpoint protegido comun (el middleware de auth.ts no reconoce ese
// campo, pero igual falla al no traer un roleId con la forma esperada -
// esta doble verificacion es la que realmente lo bloquea).
export interface PendingTotpTokenPayload {
  sub: string
  tenantId: string
  purpose: 'totp-pending'
}

const PENDING_TOTP_EXPIRES_IN = '5m'

export function signPendingTotpToken(payload: { sub: string; tenantId: string }, secret: string): string {
  return jwt.sign({ ...payload, purpose: 'totp-pending' }, secret, { expiresIn: PENDING_TOTP_EXPIRES_IN })
}

export function verifyPendingTotpToken(token: string, secret: string): { sub: string; tenantId: string } {
  const decoded = jwt.verify(token, secret) as PendingTotpTokenPayload
  if (decoded.purpose !== 'totp-pending') {
    throw new Error('Token no es de tipo totp-pending')
  }
  return { sub: decoded.sub, tenantId: decoded.tenantId }
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
