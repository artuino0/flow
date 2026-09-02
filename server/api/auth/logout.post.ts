import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } from '~/server/utils/auth'

// POST /api/auth/logout (HU-ERD-22, extendido en HU-ERD-83 parte 2): limpia
// AMBAS cookies httpOnly (access + refresh) - borrar solo el access token
// dejaria el refresh token vivo, y el siguiente POST /api/auth/refresh (por
// ejemplo el del composable de inactividad, si llegara a dispararse antes de
// que la navegacion a /login termine) reabriria la sesion sola. Publico (no
// requiere token valido) para que siempre se pueda "salir" aunque el access
// token ya haya expirado.
export default defineEventHandler((event) => {
  const expiredOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  }
  setCookie(event, AUTH_COOKIE_NAME, '', expiredOptions)
  setCookie(event, REFRESH_COOKIE_NAME, '', expiredOptions)
  return { ok: true }
})
