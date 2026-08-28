import { AUTH_COOKIE_NAME } from '~/server/utils/auth'

// POST /api/auth/logout (HU-ERD-22): limpia la cookie httpOnly del JWT.
// Publico (no requiere token valido) para que siempre se pueda "salir"
// aunque el token ya haya expirado.
export default defineEventHandler((event) => {
  setCookie(event, AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })
  return { ok: true }
})
