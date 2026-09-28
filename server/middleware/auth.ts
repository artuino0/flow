import { AUTH_COOKIE_NAME, resolveAuthToken, verifyAuthToken } from '~/server/utils/auth'
import { resolveApiKeyAuth } from '~/server/utils/apiKeyAuth'
import { validateSession } from '~/server/utils/sessions'
import { setRecordActor } from '~/server/utils/recordActorContext'

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
  // HU multi-organizacion (2026-09-04): igual que login/totp - recibe un
  // token pendiente propio en el body, no una sesion.
  '/api/auth/login/select-org',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/register',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/confirm',
  '/api/config',
  '/api/license/status',
  '/api/license/activate',
  '/api/sites/forms/submit',
  // Lo invoca Vercel Cron / un cron externo con `Authorization: Bearer CRON_SECRET`.
  '/api/cron/job-queue',
  '/api/cron/trigger-retries',
  '/api/cron/olap-etl',
  '/api/cron/billing-usage',
  // Stripe authenticates this endpoint with stripe-signature, not a Flow session.
  '/api/billing/webhook',
  // HU-ERD-84: aceptar una invitacion pasa el token en el body (no una
  // sesion) - el invitado todavia no tiene cuenta activa para autenticarse.
  '/api/users/accept-invitation',
  // HU multi-organizacion: Paso 2 del wizard de Registro consulta esto
  // ANTES de que exista cuenta - publico, no filtra nada sensible (solo si
  // un slug ya esta tomado).
  '/api/tenants/check-slug'
])

export default defineEventHandler(async (event) => {
  setRecordActor({ userId: null, roleId: null })
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
    //
    // Mismo motivo exacto para "org-pending" (HU multi-organizacion,
    // 2026-09-04): solo sirve para POST /api/auth/login/select-org.
    const purpose = (payload as unknown as { purpose?: string }).purpose
    if (purpose) {
      throw new Error('Token pendiente (2FA u organizacion), no es una sesion valida')
    }
    await validateSession(payload)
    event.context.auth = payload
    setRecordActor({ userId: payload.sub, roleId: payload.roleId })
  } catch {
    const apiAuth = await resolveApiKeyAuth(token).catch(() => null)
    if (!apiAuth) throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado' })
    if (path.startsWith('/api/auth/')) throw createError({ statusCode: 403, statusMessage: 'Las API keys no pueden administrar cuentas o sesiones' })
    event.context.auth = apiAuth.auth
    setRecordActor({ userId: apiAuth.auth.sub, roleId: apiAuth.auth.roleId })
    event.context.apiKeyId = apiAuth.apiKeyId
    event.context.apiKeyScopes = apiAuth.scopes
  }
})
