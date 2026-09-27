import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

const { enqueueEmail } = vi.hoisted(() => ({ enqueueEmail: vi.fn(async (_tenantId: string, _payload: { to: string; subject: string; html: string }) => 'email-job') }))
vi.mock('../../server/utils/jobQueue', () => ({ enqueueEmail }))

let testDb: TestDb
let admin: postgres.Sql
let requestPasswordReset: (email: string) => Promise<void>
let confirmPasswordReset: (token: string, password: string) => Promise<boolean>
let passwordResetRateKey: (token: string) => Promise<string>
let requestHandler: (event: any) => Promise<{ ok: boolean; message: string }>
let confirmHandler: (event: any) => Promise<{ ok: boolean }>
let loginHandler: (event: any) => Promise<any>
let resetAllRateLimits: () => void
let personId: string
let tenantId: string
let userId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  tenantId = randomUUID()
  await admin`insert into tenants (id, name) values (${tenantId}, 'Password reset test')`
  const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Administrador', true) returning id`
  const [person] = await admin`insert into people (email, password_hash, totp_enabled) values ('reset@test.com', ${await bcrypt.hash('vieja1234', 4)}, true) returning id`
  personId = person.id
  const [user] = await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${tenantId}, ${personId}, ${role.id}, true) returning id`
  userId = user.id
  process.env.APP_DATABASE_URL = testDb.appUrl
  vi.stubGlobal('defineEventHandler', (handler: any) => handler)
  vi.stubGlobal('readValidatedBody', async (event: any, parse: any) => parse(event.context.body))
  vi.stubGlobal('getRequestIP', (event: any) => event.context.ip)
  vi.stubGlobal('createError', (options: any) => Object.assign(new Error(options.statusMessage), options))
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: 'password-reset-test-secret' }))
  ;({ requestPasswordReset, confirmPasswordReset, passwordResetRateKey } = await import('../../server/utils/passwordReset'))
  ;({ resetAllRateLimits } = await import('../../server/utils/rateLimit'))
  ;({ default: requestHandler } = await import('../../server/api/auth/password-reset/request.post'))
  ;({ default: confirmHandler } = await import('../../server/api/auth/password-reset/confirm.post'))
  ;({ default: loginHandler } = await import('../../server/api/auth/login.post'))
}, 60_000)

beforeEach(() => {
  enqueueEmail.mockClear()
  resetAllRateLimits()
})

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

describe('recuperación de contraseña (Postgres real)', () => {
  it('no encola para un correo inexistente y encola para una persona activa sin persistir el token crudo', async () => {
    await requestPasswordReset('ausente@test.com')
    expect(enqueueEmail).not.toHaveBeenCalled()
    await requestPasswordReset('reset@test.com')
    expect(enqueueEmail).toHaveBeenCalledTimes(1)
    const [row] = await admin`select token_hash, expires_at, used_at from password_reset_tokens where person_id = ${personId}`
    const html = enqueueEmail.mock.calls[0]?.[1].html ?? ''
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000)
    expect(row.used_at).toBeNull()
    expect(html).not.toContain(row.token_hash)
  })

  it('no emite enlace para una cuenta sin membresía activa', async () => {
    const [inactive] = await admin`insert into people (email, password_hash) values ('inactive-reset@test.com', ${await bcrypt.hash('vieja1234', 4)}) returning id`
    const [role] = await admin`select id from roles where tenant_id = ${tenantId} limit 1`
    await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${tenantId}, ${inactive.id}, ${role.id}, false)`
    await requestPasswordReset('inactive-reset@test.com')
    expect(enqueueEmail).not.toHaveBeenCalled()
    const rows = await admin`select id from password_reset_tokens where person_id = ${inactive.id}`
    expect(rows).toHaveLength(0)
  })

  it('invalida enlaces anteriores al emitir uno nuevo', async () => {
    await admin`delete from password_reset_tokens where person_id = ${personId}`
    await requestPasswordReset('reset@test.com')
    const [first] = await admin`select token_hash from password_reset_tokens where person_id = ${personId} order by created_at desc limit 1`
    const firstHtml = enqueueEmail.mock.calls.at(-1)?.[1].html ?? ''
    const firstToken = firstHtml.match(/restablecer\/([^<" ]+)/)?.[1]
    expect(firstToken).toBeTruthy()
    await requestPasswordReset('reset@test.com')
    const [old] = await admin`select used_at from password_reset_tokens where token_hash = ${first.token_hash}`
    expect(old.used_at).not.toBeNull()
    expect(await confirmPasswordReset(firstToken!, 'nueva1234')).toBe(false)
  })

  it('conserva un solo enlace pendiente ante solicitudes simultáneas', async () => {
    await Promise.all([requestPasswordReset('reset@test.com'), requestPasswordReset('reset@test.com')])
    const rows = await admin`select id from password_reset_tokens where person_id = ${personId} and used_at is null and expires_at > now()`
    expect(rows).toHaveLength(1)
  })

  it('consume token válido una vez, cambia credencial, conserva 2FA y cierra sesiones de la persona', async () => {
    const secondTenantId = randomUUID()
    await admin`insert into tenants (id, name) values (${secondTenantId}, 'Second reset tenant')`
    const [secondRole] = await admin`insert into roles (tenant_id, name, is_system) values (${secondTenantId}, 'Administrador', true) returning id`
    const [secondUser] = await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${secondTenantId}, ${personId}, ${secondRole.id}, true) returning id`
    const token = 'token-real-' + randomUUID()
    await admin`insert into password_reset_tokens (person_id, token_hash, expires_at) values (${personId}, ${tokenHash(token)}, now() + interval '60 minutes')`
    await admin`insert into auth_sessions (tenant_id, user_id, expires_at) values (${tenantId}, ${userId}, now() + interval '1 day')`
    await admin`insert into auth_sessions (tenant_id, user_id, expires_at) values (${secondTenantId}, ${secondUser.id}, now() + interval '1 day')`
    expect(await passwordResetRateKey(token)).toBe('reset@test.com')
    expect(await confirmPasswordReset(token, 'nueva1234')).toBe(true)
    expect(await confirmPasswordReset(token, 'otra1234')).toBe(false)
    const [person] = await admin`select password_hash, totp_enabled from people where id = ${personId}`
    expect(await bcrypt.compare('nueva1234', person.password_hash)).toBe(true)
    expect(await bcrypt.compare('vieja1234', person.password_hash)).toBe(false)
    expect(person.totp_enabled).toBe(true)
    const sessions = await admin`select revoked_at from auth_sessions where user_id in (${userId}, ${secondUser.id})`
    expect(sessions).toHaveLength(2)
    expect(sessions.every(session => session.revoked_at !== null)).toBe(true)
    const loginEvent = (password: string) => ({ context: { body: { email: 'reset@test.com', password } } })
    await expect(loginHandler(loginEvent('vieja1234'))).rejects.toMatchObject({ statusCode: 401 })
    await expect(loginHandler(loginEvent('nueva1234'))).resolves.toMatchObject({ ok: true, requiresTotp: true })
  })

  it('rechaza token vencido o alterado', async () => {
    const expired = 'expired-' + randomUUID()
    await admin`insert into password_reset_tokens (person_id, token_hash, expires_at) values (${personId}, ${tokenHash(expired)}, now() - interval '1 minute')`
    expect(await confirmPasswordReset(expired, 'nueva1234')).toBe(false)
    expect(await confirmPasswordReset(expired + 'x', 'nueva1234')).toBe(false)
  })

  it('responde igual para correo existente e inexistente, y no encola para el inexistente', async () => {
    const absent = await requestHandler({ context: { body: { email: 'nobody@test.com' }, ip: '198.51.100.10' } })
    expect(enqueueEmail).not.toHaveBeenCalled()
    const existing = await requestHandler({ context: { body: { email: 'reset@test.com' }, ip: '198.51.100.10' } })
    expect(existing).toEqual(absent)
    expect(enqueueEmail).toHaveBeenCalledTimes(1)
  })

  it('mantiene la respuesta neutra si falla la cola de correo', async () => {
    enqueueEmail.mockRejectedValueOnce(new Error('cola indisponible'))
    const result = await requestHandler({ context: { body: { email: 'reset@test.com' }, ip: '198.51.100.11' } })
    expect(result.message).toContain('Si el correo existe')
  })

  it('limita solicitudes por correo y por IP sin revelar la cuenta', async () => {
    for (let i = 0; i < 5; i++) await requestHandler({ context: { body: { email: 'reset@test.com' }, ip: `198.51.100.${i + 20}` } })
    expect(enqueueEmail).toHaveBeenCalledTimes(5)
    const limitedEmail = await requestHandler({ context: { body: { email: 'reset@test.com' }, ip: '198.51.100.50' } })
    const neutral = await requestHandler({ context: { body: { email: 'nobody@test.com' }, ip: '198.51.100.51' } })
    expect(limitedEmail).toEqual(neutral)
    resetAllRateLimits()
    for (let i = 0; i < 5; i++) await requestHandler({ context: { body: { email: `other${i}@test.com` }, ip: '198.51.100.90' } })
    await requestHandler({ context: { body: { email: 'reset@test.com' }, ip: '198.51.100.90' } })
    expect(enqueueEmail).toHaveBeenCalledTimes(5)
  })

  it('limita confirmaciones por correo y por IP, y exige la política de contraseña', async () => {
    const token = 'confirm-' + randomUUID()
    await admin`insert into password_reset_tokens (person_id, token_hash, expires_at) values (${personId}, ${tokenHash(token)}, now() - interval '1 minute')`
    const event = (value: string, ip: string) => ({ context: { body: { token: value, password: 'válida1234' }, ip } })
    await expect(confirmHandler(event(token, '198.51.100.100'))).rejects.toMatchObject({ statusCode: 400 })
    for (let i = 0; i < 4; i++) await expect(confirmHandler(event('alterado-' + i, '198.51.100.100'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(confirmHandler(event('otro-token', '198.51.100.100'))).rejects.toMatchObject({ statusCode: 429 })
    for (let i = 0; i < 4; i++) await expect(confirmHandler(event(token, `198.51.100.${110 + i}`))).rejects.toMatchObject({ statusCode: 400 })
    await expect(confirmHandler(event(token, '198.51.100.120'))).rejects.toMatchObject({ statusCode: 429 })
    await expect(confirmHandler({ context: { body: { token, password: 'débil' }, ip: '198.51.100.121' } })).rejects.toThrow()
  })
})
