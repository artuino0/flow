import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError, getCookie, getHeader, getRequestURL, setHeader, type H3Event } from 'h3'
import { AUTH_COOKIE_NAME, verifyAuthToken, type AuthTokenPayload } from '~/server/utils/auth'
import { requireAuth } from '~/server/utils/rbac'
const attempts = new Map<string, { count: number; start: number; blockedUntil: number }>()
export function sessionKey(secret: string, jwtSecret: string) { return secret || createHmac('sha256', jwtSecret).update('AGENT_SESSION_KEY_V1').digest('hex') }
export function signAgentToken(auth: AuthTokenPayload, secret: string, now = Date.now()) {
 const payload = Buffer.from(JSON.stringify({ userId: auth.sub, tenantId: auth.tenantId, sessionId: auth.sid, context: 'agent-v1', exp: now + 600_000 })).toString('base64url')
 return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
export function validAgentToken(token: string, auth: AuthTokenPayload, secret: string, now = Date.now()) {
 try {
  if (token.length > 2048) return false
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return false
  const expected = createHmac('sha256', secret).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
  return data.context === 'agent-v1' && data.exp > now && data.exp <= now + 600_000 && data.userId === auth.sub && data.tenantId === auth.tenantId && Boolean(auth.sid) && data.sessionId === auth.sid
 } catch { return false }
}
export function sameAgentOrigin(origin: string | undefined, referer: string | undefined, site: string | undefined, expected: string, method: string) {
 if (site && site !== 'same-origin') return false
 // GET del navegador no lleva Origin; exige Referer del mismo origen.
 if (!origin && method !== 'GET') return false
 try { return new URL(origin || referer || '').origin === expected && (!referer || new URL(referer).origin === expected) } catch { return false }
}
export function agentBlocked(event: H3Event, auth: AuthTokenPayload, reason: string): never {
 const key = `${auth.tenantId}:${auth.sub}`; const now = Date.now()
 if (attempts.size > 5000) for (const [id, item] of attempts) if (item.start + 300_000 < now && item.blockedUntil < now) attempts.delete(id)
 const previous = attempts.get(key)
 const state = previous && now - previous.start < 60_000 ? previous : { count: 0, start: now, blockedUntil: previous?.blockedUntil ?? 0 }
 state.count++; if (state.count >= 10) state.blockedUntil = now + 180_000
 attempts.set(key, state)
 console.info(JSON.stringify({ event: 'agent_blocked', reason, userId: auth.sub, tenantId: auth.tenantId }))
 if (state.blockedUntil > now) { setHeader(event, 'Retry-After', Math.ceil((state.blockedUntil - now) / 1000)); throw createError({ statusCode: 429, statusMessage: 'Intenta de nuevo más tarde' }) }
 throw createError({ statusCode: 403, statusMessage: 'Acceso no permitido' })
}
export function requireAgentSession(event: H3Event, requireToken = true) {
 const auth = requireAuth(event)
 const blocked = attempts.get(`${auth.tenantId}:${auth.sub}`)
 if (blocked && blocked.blockedUntil > Date.now()) return agentBlocked(event, auth, 'burst')
 const cookie = getCookie(event, AUTH_COOKIE_NAME)
 const config = useRuntimeConfig()
 if (event.context.apiKeyId || getHeader(event, 'authorization') || !auth.sid || !cookie) return agentBlocked(event, auth, 'auth_type')
 let interactive: AuthTokenPayload
 try { interactive = verifyAuthToken(cookie, String(config.jwtSecret)) } catch { return agentBlocked(event, auth, 'auth_type') }
 if (interactive.sub !== auth.sub || interactive.tenantId !== auth.tenantId || interactive.sid !== auth.sid) return agentBlocked(event, auth, 'auth_type')
 const expected = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : getRequestURL(event).origin
 if (!sameAgentOrigin(getHeader(event, 'origin'), getHeader(event, 'referer'), getHeader(event, 'sec-fetch-site'), expected, event.method)) return agentBlocked(event, auth, 'origin')
 const secret = sessionKey(process.env.AGENT_SESSION_SECRET || '', String(config.jwtSecret))
 if (requireToken && !validAgentToken(getHeader(event, 'x-agent-token') || '', auth, secret)) return agentBlocked(event, auth, 'token')
 return { auth, secret }
}
