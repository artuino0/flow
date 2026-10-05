import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import * as h3 from 'h3'
import { writeFileSync } from 'node:fs'
import { generate, generateSecret } from 'otplib'
import { createTestDb, type TestDb } from '../setup/testDb'
import { measureLocalDatabase } from '../../scripts/performanceDb182'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { newRequestPerformance, performanceScope } from '../../server/utils/requestPerformance'

vi.mock('../../server/utils/mailer', () => ({ sendPlainEmail: vi.fn(), sendVerificationEmail: vi.fn() }))
const tenant = randomUUID(), otherTenant = randomUUID(), secret = 'local-183-fixture-secret', email = 'fixture183@test.local', password = 'Local-183-fixture'
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db')
let authUtils: typeof import('../../server/utils/auth'), middleware: (event: h3.H3Event) => unknown
let userId: string, roleId: string, personId: string, token: string
let restore: (() => void) | undefined
let current: { endpoint: string; queries: number; trips: number; ms: number; bytes: number } | undefined
const results: NonNullable<typeof current>[] = []
function event(url: string, body?: unknown, cookies?: string) {
  const req = new IncomingMessage(new Socket()); req.url = url; req.method = body ? 'POST' : 'GET'
  req.headers = { host: 'localhost:3000', authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(cookies ? { cookie: cookies } : {}) }
  if (body) { const json = JSON.stringify(body); req.headers['content-length'] = String(Buffer.byteLength(json)); req.push(json) }; req.push(null)
  return h3.createEvent(req, new ServerResponse(req))
}
function cookies(request: h3.H3Event) {
  return (request.node.res.getHeader('set-cookie') as string[]).map(value => value.split(';')[0]).join('; ')
}
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = 'http://localhost:3000'; process.env.JWT_SECRET = secret
  process.env.APP_MODE = 'saas'; process.env.ACCESS_CACHE_TTL_MS = '5000'; process.env.SESSION_CACHE_TTL_MS = '10000'
  process.env.METADATA_CACHE_TTL_MS = '30000'
  for (const [key, value] of Object.entries(h3)) vi.stubGlobal(key, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: secret, appMode: 'saas' }))
  // Como HU-182: fija edad de cachés; la demora por viaje sigue usando timers reales.
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 60_000)
  authUtils = await import('../../server/utils/auth')
  await admin`insert into tenants(id,name,slug,onboarding_status) values (${tenant},'Fixture 183',${'fixture-' + tenant},'complete'),(${otherTenant},'Otra organización',${'fixture-' + otherTenant},'complete')`
  ;[{ id: roleId }] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id` as unknown as [{ id: string }]
  ;[{ id: personId }] = await admin`insert into people(email,password_hash,email_verified_at,full_name) values (${email},${await authUtils.hashPassword(password)},now(),'Persona 183') returning id` as unknown as [{ id: string }]
  ;[{ id: userId }] = await admin`insert into users(tenant_id,person_id,role_id,is_active,job_title,timezone) values (${tenant},${personId},${roleId},true,'Operaciones','America/Mexico_City') returning id` as unknown as [{ id: string }]
  const [{ id: sid }] = await admin`insert into auth_sessions(tenant_id,user_id,expires_at) values (${tenant},${userId},now()+interval '7 days') returning id`
  token = authUtils.signAuthToken({ sub: userId, tenantId: tenant, roleId, sid }, secret)
  connection = await import('../../server/db'); middleware = (await import('../../server/middleware/auth')).default
  const { sql } = await import('drizzle-orm')
  await Promise.all(Array.from({ length: 4 }, () => connection.db.execute(sql`select pg_sleep(0.01)`)))
  restore = measureLocalDatabase(connection.client, () => Boolean(current), Number(process.env.ERD183_LATENCY_MS ?? 0), query => {
    current!.trips++; if (!/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(query)) current!.queries++
  })
}, 90000)
afterAll(async () => { restore?.(); await connection?.client.end(); await admin?.end(); await database?.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.APP_DATABASE_URL })

it('mide cada endpoint del arranque con el arnés HU-182 y actor/RLS reales', async () => {
  const handlers: Array<[string, () => Promise<{ default: (event: h3.H3Event) => unknown }>, boolean?, unknown?]> = [
    ['/api/auth/login', () => import('../../server/api/auth/login.post'), false, { email, password }],
    ['/api/auth/me', () => import('../../server/api/auth/me.get')],
    ['/api/roles', () => import('../../server/api/roles/index.get')],
    ['/api/license/status', () => import('../../server/api/license/status.get'), false],
    ['/api/apps', () => import('../../server/api/apps.get')],
    ['/api/nav/entities', () => import('../../server/api/nav/entities.get')],
    ['/api/dashboard/operational', () => import('../../server/api/dashboard/operational.get')],
    ['/api/dashboard/shortcuts', () => import('../../server/api/dashboard/shortcuts.get')],
    ['/api/sites', () => import('../../server/api/sites/index.get')],
    ['/api/billing/plan-usage', () => import('../../server/api/billing/plan-usage.get')],
    ['/api/billing/overview', () => import('../../server/api/billing/overview.get')],
    ['/api/notifications?limit=30', () => import('../../server/api/notifications/index.get')],
    ['/api/chat/permissions', () => import('../../server/api/chat/permissions.get')],
    ['/api/chat/conversations', () => import('../../server/api/chat/conversations/index.get')],
    ['/api/chat/conversations?archived=true', () => import('../../server/api/chat/conversations/index.get')]
  ]
  for (const [url, importer, authenticated = true, body] of handlers) {
    const handler = (await importer()).default, req = event(url, body)
    current = { endpoint: url, queries: 0, trips: 0, ms: 0, bytes: 0 }
    const start = performance.now(), metrics = newRequestPerformance()
    const value = await performanceScope(metrics, () => withRecordActor({ userId, roleId }, async () => { if (authenticated) await middleware(req); return handler(req) }))
    expect(metrics.queries, url).toBe(current.queries); expect(metrics.trips, url).toBe(current.trips)
    current.ms = Math.round(performance.now() - start); current.bytes = Buffer.byteLength(JSON.stringify(value)); results.push(current); current = undefined
  }
  const sessionRequest = event('/api/auth/login', { email, password })
  await (await import('../../server/api/auth/login.post')).default(sessionRequest)
  const req = event('/api/auth/refresh', {}, cookies(sessionRequest)), handler = (await import('../../server/api/auth/refresh.post')).default
  current = { endpoint: '/api/auth/refresh', queries: 0, trips: 0, ms: 0, bytes: 0 }; const start = performance.now()
  const value = await withRecordActor({ userId, roleId }, () => handler(req))
  current.ms = Math.round(performance.now() - start); current.bytes = Buffer.byteLength(JSON.stringify(value)); results.push(current); current = undefined
  if (process.env.ERD183_STAGE) writeFileSync(`C:/desarrollo/ERP-Dinamico/DOCS/tareas/erd183-server-${process.env.ERD183_STAGE}.json`, JSON.stringify({ latencyMs: Number(process.env.ERD183_LATENCY_MS ?? 0), fixture: 'Usuario sintético administrador verificado, organización vacía; cachés cortas HU-182; no red cliente ni render', results }, null, 2))
}, 90000)

it('login, me, TOTP, elección de organización y refresh devuelven la misma identidad completa', async () => {
  const login = (await import('../../server/api/auth/login.post')).default
  const req = event('/api/auth/login', { email, password })
  const direct = await login(req)
  expect(direct).toMatchObject({ user: { id: userId, tenantId: tenant, roleId, isAdmin: true, email, fullName: 'Persona 183', jobTitle: 'Operaciones', timezone: 'America/Mexico_City', authenticated: true, emailVerified: true, onboardingStatus: 'complete', totpEnabled: false } })
  const profile = (direct as { user: { sessionId: string } }).user
  expect(profile.sessionId).toBeTruthy()
  const meRequest = event('/api/auth/me'); meRequest.context.auth = { sub: userId, tenantId: tenant, roleId, sid: profile.sessionId }
  expect(await (await import('../../server/api/auth/me.get')).default(meRequest)).toEqual((direct as { user: unknown }).user)
  const refreshed = await (await import('../../server/api/auth/refresh.post')).default(event('/api/auth/refresh', {}, cookies(req)))
  expect(refreshed).toMatchObject({ user: profile })
  const totpSecret = generateSecret(); await admin`update people set totp_enabled=true,totp_secret=${totpSecret} where id=${personId}`
  const pending = await login(event('/api/auth/login', { email, password })) as { tempToken: string }
  expect(pending).not.toHaveProperty('user')
  const totp = await (await import('../../server/api/auth/login/totp.post')).default(event('/api/auth/login/totp', { tempToken: pending.tempToken, code: await generate({ secret: totpSecret }) }))
  expect(totp).toMatchObject({ user: { isAdmin: true, totpEnabled: true, id: userId } })
  await admin`update people set totp_enabled=false where id=${personId}`
  const [{ id: otherRole }] = await admin`insert into roles(tenant_id,name,is_system) values (${otherTenant},'Miembro',false) returning id`
  const [{ id: otherUser }] = await admin`insert into users(tenant_id,person_id,role_id,is_active) values (${otherTenant},${personId},${otherRole},true) returning id`
  const organizations = await login(event('/api/auth/login', { email, password })) as { pendingToken: string }
  expect(organizations).not.toHaveProperty('user')
  const chosen = await (await import('../../server/api/auth/login/select-org.post')).default(event('/api/auth/login/select-org', { pendingToken: organizations.pendingToken, tenantId: otherTenant }))
  expect(chosen).toMatchObject({ user: { id: otherUser, tenantId: otherTenant, roleId: otherRole, isAdmin: false } })
  await admin`update users set is_active=false where id=${otherUser}`
})

it('TOTP inválido, organización ajena y sesión revocada no emiten cookies', async () => {
  const totp = (await import('../../server/api/auth/login/totp.post')).default
  const select = (await import('../../server/api/auth/login/select-org.post')).default
  const refresh = (await import('../../server/api/auth/refresh.post')).default
  const totpSecret = generateSecret()
  await admin`update people set totp_enabled=true,totp_secret=${totpSecret} where id=${personId}`
  try {
    const pending = authUtils.signPendingTotpToken({ sub: personId }, secret)
    // Una longitud inválida también queda fuera de la ventana TOTP tolerada.
    const invalid = event('/api/auth/login/totp', { tempToken: pending, code: '00000' })
    await expect(totp(invalid)).rejects.toMatchObject({ statusCode: 401 })
    expect(invalid.node.res.getHeader('set-cookie')).toBeUndefined()
  } finally {
    await admin`update people set totp_enabled=false where id=${personId}`
  }
  const unauthorized = event('/api/auth/login/select-org', { pendingToken: authUtils.signPendingOrgToken({ sub: personId }, secret), tenantId: randomUUID() })
  await expect(select(unauthorized)).rejects.toMatchObject({ statusCode: 401 })
  expect(unauthorized.node.res.getHeader('set-cookie')).toBeUndefined()
  const request = event('/api/auth/login', { email, password })
  const result = await (await import('../../server/api/auth/login.post')).default(request) as { user: { sessionId: string } }
  await admin`update auth_sessions set revoked_at=now() where id=${result.user.sessionId}`
  const revoked = event('/api/auth/refresh', {}, cookies(request))
  await expect(refresh(revoked)).rejects.toMatchObject({ statusCode: 401 })
  expect(revoked.node.res.getHeader('set-cookie')).toBeUndefined()
})

it('roles personalizados, cambio de rol, API key y ausencia de rol conservan la decisión del guard', async () => {
  const rbac = await import('../../server/utils/rbac'), me = (await import('../../server/api/auth/me.get')).default
  const [{ id: custom }] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Personalizado',false) returning id`
  await admin`update users set role_id=${custom} where id=${userId}`
  const [{ id: roleEntity }] = await admin`insert into entities(tenant_id,name,slug) values (${tenant},'Roles','roles') returning id`
  for (const permissions of [false, true]) {
    await admin`insert into role_entity_permissions(role_id,entity_id,can_read,can_create,can_update,can_delete) values (${custom},${roleEntity},${permissions},${permissions},${permissions},${permissions}) on conflict(role_id,entity_id) do update set can_read=${permissions},can_create=${permissions},can_update=${permissions},can_delete=${permissions}`
    const req = event('/api/auth/me'); req.context.auth = { sub: userId, tenantId: tenant, roleId: custom }
    expect(await me(req)).toMatchObject({ isAdmin: false }); await expect(rbac.requireAdminRole(req)).rejects.toMatchObject({ statusCode: 403 })
  }
  await admin`update users set role_id=${custom} where id=${userId}`
  const changed = event('/api/auth/me'); await middleware(changed)
  expect(await me(changed)).toMatchObject({ roleId: custom, isAdmin: false })
  await admin`update users set role_id=${roleId} where id=${userId}`
  const api = event('/api/auth/me'); api.context.auth = { sub: userId, tenantId: tenant, roleId }; api.context.apiKeyId = randomUUID()
  expect(await me(api)).toMatchObject({ isAdmin: false }); await expect(rbac.requireAdminRole(api)).rejects.toMatchObject({ statusCode: 403 })
  expect(await rbac.isAdminUser({ sub: userId, tenantId: tenant, roleId: null })).toBe(false)
})
