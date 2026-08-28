import type { AuthTokenPayload } from '~/server/utils/auth'

// Endpoint protegido de ejemplo (HU-ERD-14/HU-ERD-15): el middleware global
// (server/middleware/auth.ts) ya valido el JWT y dejo el payload en
// event.context.auth antes de que este handler se ejecute.
export default defineEventHandler((event) => {
  const auth = event.context.auth as AuthTokenPayload
  return { authenticated: true, ...auth }
})
