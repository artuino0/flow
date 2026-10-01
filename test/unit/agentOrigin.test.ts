import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, setHeader } from 'h3'
import { allowedRequestOrigins } from '../../server/utils/requestOrigin'
import { requireAgentSession, sameAgentOrigin, sessionKey, validAgentToken } from '../../server/utils/agent/security'
import { signAuthToken } from '../../server/utils/auth'

const adcf = 'https://flow-production-adcf.up.railway.app'
const dada = 'https://flow-production-dada.up.railway.app'
function event(origin = dada, method = 'GET', headers: Record<string, string | undefined> = {}) {
 const auth = { sub: randomUUID(), tenantId: randomUUID(), roleId: randomUUID(), sid: randomUUID() }
 const req = new IncomingMessage(new Socket())
 req.method = method; req.url = '/api/agent/session'
 req.headers = { host: 'upstream:3000', 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': new URL(origin).protocol.slice(0, -1), origin, referer: `${origin}/ajustes`, 'sec-fetch-site': 'same-origin', cookie: `erp_auth_token=${signAuthToken(auth, 'test-secret')}`, ...headers }
 const e = createEvent(req, new ServerResponse(req)); e.context.auth = auth
 return e
}
beforeEach(() => {
 vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_BASE_URL', adcf)
 vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', new URL(dada).host); vi.stubEnv('RAILWAY_STATIC_URL', '')
 vi.stubEnv('AGENT_ALLOWED_ORIGINS', ''); vi.stubEnv('AGENT_SESSION_SECRET', '')
 vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Red prohibida en ERD-146') }))
 vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: 'test-secret' }))
 vi.stubGlobal('createError', (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage)), options))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('ERD-146 conjunto de orígenes y proxy', () => {
 it('reproduce el bloqueo del conjunto antiguo y permite los dos dominios', () => {
  expect(sameAgentOrigin(dada, `${dada}/`, 'same-origin', new Set([adcf]), 'GET')).toBe(false)
  for (const origin of [adcf, dada]) {
   const e = event(origin)
   expect(allowedRequestOrigins(e)).toEqual(new Set([adcf, dada]))
   expect(requireAgentSession(e, false).auth).toBe(e.context.auth)
  }
 })
 it.each([adcf, dada])('session real emite HMAC válido desde %s sin IA', async origin => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler); vi.stubGlobal('setHeader', setHeader)
  const endpoint = (await import('../../server/api/agent/session.get')).default
  const e = event(origin, 'GET', { origin: undefined })
  const result = await endpoint(e)
  expect(result.expiresInSec).toBe(600)
  expect(validAgentToken(result.token, e.context.auth, sessionKey('', 'test-secret'))).toBe(true)
  expect(e.node.res.getHeader('Cache-Control')).toBe('no-store')
  const post = event(origin, 'POST', { 'x-agent-token': result.token })
  post.context.auth = e.context.auth
  post.node.req.headers.cookie = e.node.req.headers.cookie
  expect(requireAgentSession(post).auth).toBe(e.context.auth)
  expect(fetch).not.toHaveBeenCalled()
 })
 it('token sigue siendo reutilizable entre orígenes autorizados de la misma sesión', async () => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler); vi.stubGlobal('setHeader', setHeader)
  const endpoint = (await import('../../server/api/agent/session.get')).default
  const e = event(adcf); const result = await endpoint(e)
  const post = event(dada, 'POST', { 'x-agent-token': result.token, cookie: e.node.req.headers.cookie as string })
  post.context.auth = e.context.auth
  expect(requireAgentSession(post).auth).toBe(e.context.auth)
 })
 it.each([
  { origin: 'https://evil.example' }, { origin: undefined },
  { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  { referer: 'https://evil.example/private' }, { referer: `${adcf}/` }
 ])('POST rechazado conserva reason origin y logs privados: %j', headers => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const e = event(dada, 'POST', headers); e.context.privateMessage = 'MENSAJE PRIVADO ERD-146'
  expect(() => requireAgentSession(e, false)).toThrow(expect.objectContaining({ statusCode: 403 }))
  expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({ event: 'agent_blocked', reason: 'origin', userId: e.context.auth.sub, tenantId: e.context.auth.tenantId })
  expect(log.mock.calls.flat().join('')).not.toMatch(/MENSAJE PRIVADO|test-secret|cookie|private/)
 })
 it('GET sin Origin exige Referer permitido; fetch-site ausente sigue permitido', () => {
  expect(requireAgentSession(event(dada, 'GET', { origin: undefined, 'sec-fetch-site': undefined }), false)).toBeDefined()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  for (const referer of [undefined, 'https://evil.example/', 'invalid']) {
   expect(() => requireAgentSession(event(dada, 'GET', { origin: undefined, referer }), false)).toThrow(expect.objectContaining({ statusCode: 403 }))
  }
 })
 it('lista opcional ignora entradas inválidas, vacías y HTTP en producción', () => {
  vi.stubEnv('AGENT_ALLOWED_ORIGINS', 'https://extra.example, https://extra.example/,https://extra.example/path,ftp://ftp.example,,bad,http://localhost:3000,https://user:pass@secret.example,https://query.example?x=1,https://hash.example#x,https://path.example/a/..')
  const origins = allowedRequestOrigins(event())
  expect(origins).toEqual(new Set([adcf, dada, 'https://extra.example']))
  expect(sameAgentOrigin('https://extra.example', undefined, 'same-origin', origins, 'POST')).toBe(true)
 })
 it('APP_BASE_URL sigue aportando su origen aunque incluya ruta', () => {
  vi.stubEnv('APP_BASE_URL', `${adcf}/app`)
  expect(allowedRequestOrigins(event())).toEqual(new Set([adcf, dada]))
 })
 it.each(['flow-production-dada.up.railway.app', `${dada}/`])('STATIC_URL acepta dominio o URL HTTPS: %s', value => {
  vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', ''); vi.stubEnv('RAILWAY_STATIC_URL', value)
  expect(allowedRequestOrigins(event())).toEqual(new Set([adcf, dada]))
 })
 it('proxy permite un dominio real adicional y h3 usa el primer host reenviado', () => {
  const e = event('https://custom.example', 'GET', { 'x-forwarded-host': 'custom.example, internal.example' })
  expect(allowedRequestOrigins(e)).toEqual(new Set(['https://custom.example', adcf, dada]))
  expect(requireAgentSession(e, false)).toBeDefined()
 })
 it('producción ignora HTTP derivado y configurado, incluso localhost', () => {
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000'); vi.stubEnv('AGENT_ALLOWED_ORIGINS', 'http://plain.example')
  const e = event('http://localhost:3000')
  expect(allowedRequestOrigins(e)).toEqual(new Set([dada]))
  vi.spyOn(console, 'info').mockImplementation(() => {})
  expect(() => requireAgentSession(e, false)).toThrow(expect.objectContaining({ statusCode: 403 }))
 })
 it('local directo ignora cabeceras reenviadas fuera de Railway', () => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('APP_BASE_URL', ''); vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', '')
  const e = event('http://localhost:3000', 'POST', { host: 'localhost:3000', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })
  expect(allowedRequestOrigins(e)).toEqual(new Set(['http://localhost:3000']))
  expect(requireAgentSession(e, false)).toBeDefined()
  vi.stubEnv('AGENT_ALLOWED_ORIGINS', 'http://127.0.0.1:3000,http://other.example')
  expect(allowedRequestOrigins(e)).toEqual(new Set(['http://localhost:3000', 'http://127.0.0.1:3000']))
 })
 it('configuración y host inválidos no causan 500', () => {
  vi.stubEnv('APP_BASE_URL', 'invalid'); vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'bad/path'); vi.stubEnv('RAILWAY_STATIC_URL', 'ftp://bad.example')
  const e = event(dada, 'GET', { 'x-forwarded-host': 'invalid host' })
  expect(allowedRequestOrigins(e)).toEqual(new Set())
  vi.spyOn(console, 'info').mockImplementation(() => {})
  expect(() => requireAgentSession(e, false)).toThrow(expect.objectContaining({ statusCode: 403 }))
 })
})
