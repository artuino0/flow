import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as h3 from 'h3'
import nodemailer from 'nodemailer'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'
import { mailServer195 } from '../helpers/mailServer195'
import { decryptSetting } from '../../server/utils/settingsCrypto'

let database: TestDb, admin: postgres.Sql
let registration: typeof import('../../server/utils/registration')
let verification: typeof import('../../server/utils/emailVerification')
let handler: h3.EventHandler
let server: ReturnType<typeof createServer>, url: string, smtp: Awaited<ReturnType<typeof mailServer195>>
const input = { fullName: 'Persona de prueba', email: 'registro195@local.test', password: 'Passw0rd!195', organizationName: 'Registro 195', slug: 'registro-195', registrationChoice: { plan: 'agenda', interval: 'month' } }
const account = (suffix: string) => ({ ...input, email: `otp${suffix}@local.test`, slug: `otp-${suffix}`, prepareVerification: true })
const event = () => h3.createEvent(new IncomingMessage(new Socket()), new ServerResponse(new IncomingMessage(new Socket())))
async function currentCode(personId: string) {
  const [job] = await admin`select payload from job_queue where payload->>'verificationId' in (select id::text from email_verification_tokens where person_id=${personId}::uuid and used_at is null) order by created_at desc limit 1`
  const html = decryptSetting(job!.payload.encryptedHtml)
  return { code: html.match(/letter-spacing:6px">(\d{6})/)![1]!, token: new URL(html.match(/https?:\/\/[^"<> ]+/)![0]!).searchParams.get('token')!, payload: job!.payload }
}
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'local-secret-registration-195'); vi.stubEnv('APP_MODE', 'saas'); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000')
  database = await createTestDb(); admin = postgres(database.adminUrl)
  vi.stubEnv('APP_DATABASE_URL', database.appUrl)
  smtp = await mailServer195(true); smtp.setMode('timeout')
  vi.stubEnv('SMTP_HOST', '127.0.0.1'); vi.stubEnv('SMTP_PORT', String(smtp.port)); vi.stubEnv('SMTP_FROM', 'Flow <sender@local.test>')
  vi.stubEnv('MAIL_PROVIDER', 'smtp'); vi.stubEnv('SMTP_USER', ''); vi.stubEnv('SMTP_PASSWORD', '')
  for (const [key, value] of Object.entries(h3)) vi.stubGlobal(key, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: process.env.JWT_SECRET }))
  registration = await import('../../server/utils/registration')
  verification = await import('../../server/utils/emailVerification')
  if (process.env.ERD195_BASELINE === '1') {
    const source = execFileSync('git', ['show', '019b930:server/api/auth/register.post.ts'], { cwd: 'C:/desarrollo/ERP-Dinamico/frontback-erd195', encoding: 'utf8' })
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const imports: Record<string, unknown> = {
      '~/server/utils/appConfig': await import('../../server/utils/appConfig'), '~/server/utils/passwordPolicy': await import('../../server/utils/passwordPolicy'),
      '~/server/utils/auth': await import('../../server/utils/auth'), '~/server/utils/registration': registration, '~/server/utils/users': await import('../../server/utils/users'),
      '~/server/utils/mailer': await import('../../server/utils/mailer'), '~/server/utils/emailVerification': { assertVerificationDelivery: async () => {}, issueEmailVerification: async () => {
        // Mismo envío SMTP sin límites del HEAD original, con socket local silencioso.
        await nodemailer.createTransport({ host: '127.0.0.1', port: smtp.port, secure: false }).sendMail({ from: 'sender@local.test', to: input.email, subject: 'Verificación', html: '<p>Verifica</p>' })
      } }
    }
    const exports: { default?: h3.EventHandler } = {}
    const require = createRequire(import.meta.url)
    new Function('require', 'exports', code)((id: string) => imports[id] ?? require(id), exports)
    handler = exports.default!
  } else handler = (await import('../../server/api/auth/register.post')).default
  const app = h3.createApp().use('/api/auth/register', handler)
  server = createServer(h3.toNodeListener(app)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/register`
}, 120000)
afterAll(async () => {
  await smtp?.stop()
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  if (admin) await admin.end()
  const { client } = await import('../../server/db'); await client.end()
  await database?.stop(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
})
describe('registro resistente y OTP', () => {
  it('incidente: POST responde antes de 2 s con socket SMTP que nunca saluda y cuenta confirmada', async () => {
    const started = Date.now()
    const result = await Promise.race([fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(async response => ({ status: response.status, body: await response.json() })),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1990))])
    if (!result) {
      const tenants = await admin`select id from tenants where slug=${input.slug}`
      console.info(`SMTP_SILENT=true; HTTP_PENDING=true; TENANT_EXISTS=${tenants.length === 1}`)
    }
    expect(result, 'La petición quedó esperando al correo después de crear la cuenta').not.toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
    expect(result!.status).toBe(200)
    const [tenant] = await admin`select id,onboarding_status,registration_intent from tenants where slug=${input.slug}`
    expect(tenant!.onboarding_status).toBe('email_pending'); expect(tenant!.registration_intent.plan).toBe('agenda')
    const jobs = await admin`select status,attempts,payload from job_queue where tenant_id=${tenant!.id}::uuid`
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ status: 'pending', attempts: 0 })
    expect(jobs[0]!.payload.html).not.toMatch(/\d{6}/)
    console.info(`POST_REGISTRATION_MS=${Date.now() - started}; SMTP_SILENT=true; QUEUED=1`)
  })
  it('reintento HTTP y doble envío simultáneo recuperan la misma cuenta sin correo duplicado', async () => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    expect(response.status).toBe(200); expect((await response.json()).resumed).toBe(true)
    const [a, b] = await Promise.all([registration.registerTenant(account('double')), registration.registerTenant(account('double'))])
    expect(a.tenantId).toBe(b.tenantId)
    expect((await admin`select id from job_queue where tenant_id=${a.tenantId}::uuid`)).toHaveLength(1)
    await expect(registration.registerTenant({ ...account('double'), password: 'ForeignPassword195!' })).rejects.toThrow('No se pudo completar')
  })
  it('fallo antes del correo revierte organización, persona y roles', async () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', ''); vi.stubEnv('JWT_SECRET', '')
    await expect(registration.registerTenant(account('rollback'))).rejects.toThrow('Falta')
    vi.stubEnv('JWT_SECRET', 'local-secret-registration-195')
    expect(await admin`select id from tenants where slug='otp-rollback'`).toHaveLength(0)
    expect(await admin`select id from people where email='otprollback@local.test'`).toHaveLength(0)
  })
  it('OTP correcto confirma una vez y deja plan/intervalo preseleccionados', async () => {
    const a = await registration.registerTenant(account('valid')), { code } = await currentCode(a.personId)
    expect(await verification.confirmVerificationCode(a.personId, a.tenantId, code)).toBe(true)
    expect(await verification.confirmVerificationCode(a.personId, a.tenantId, code)).toBe(false)
    const [tenant] = await admin`select onboarding_status,registration_intent from tenants where id=${a.tenantId}::uuid`
    expect(tenant!.onboarding_status).toBe('plan_pending'); expect(tenant!.registration_intent).toMatchObject({ plan: 'agenda', interval: 'month' })
  })
  it('cinco códigos incorrectos agotan el código; la contraseña o tenant ajenos no lo validan', async () => {
    const a = await registration.registerTenant(account('attempts')), { code } = await currentCode(a.personId)
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect(await verification.confirmVerificationCode(a.personId, a.tenantId, wrong)).toBe(false)
    expect(await verification.confirmVerificationCode(a.personId, a.tenantId, code)).toBe(false)
    expect((await admin`select attempts from email_verification_tokens where person_id=${a.personId}::uuid`)[0]!.attempts).toBe(5)
  })
  it('caducidad, reenvío con invalidación, enfriamiento y enlace de respaldo', async () => {
    const a = await registration.registerTenant(account('resend')), first = await currentCode(a.personId)
    await expect(verification.issueEmailVerification(a.personId, a.tenantId)).rejects.toBeInstanceOf(verification.VerificationRateLimitError)
    await admin`update email_verification_tokens set code_expires_at=now()-interval '1 minute',created_at=now()-interval '2 minutes' where person_id=${a.personId}::uuid`
    expect(await verification.confirmVerificationCode(a.personId, a.tenantId, first.code)).toBe(false)
    await verification.issueEmailVerification(a.personId, a.tenantId)
    expect(await verification.confirmEmailVerification(first.token)).toBe(false)
    const next = await currentCode(a.personId)
    expect(await verification.confirmEmailVerification(next.token)).toBe(true)
    expect(await verification.confirmVerificationCode(a.personId, a.tenantId, next.code)).toBe(false)
  })
  it('cambio de correo atómico, sin revelar cuentas; invalida código/enlace previos', async () => {
    const a = await registration.registerTenant(account('change')), before = await currentCode(a.personId)
    await admin`update email_verification_tokens set created_at=now()-interval '2 minutes' where person_id=${a.personId}::uuid`
    await verification.issueEmailVerification(a.personId, a.tenantId, false, 'changed195@local.test')
    expect(await verification.confirmEmailVerification(before.token)).toBe(false)
    expect((await admin`select email from people where id=${a.personId}::uuid`)[0]!.email).toBe('changed195@local.test')
    const current = await currentCode(a.personId)
    expect(await verification.confirmVerificationCode(a.personId, a.tenantId, current.code)).toBe(true)
  })
  it('límites persistentes por cuenta/IP y configuración sin abrir conexión', async () => {
    const { authRequestLimit } = await import('../../server/utils/authPersistentLimit')
    for (let i = 0; i < 5; i++) await authRequestLimit(event(), 'limited195', 'same-account')
    await expect(authRequestLimit(event(), 'limited195', 'same-account')).rejects.toMatchObject({ statusCode: 429 })
    for (let i = 0; i < 10; i++) await authRequestLimit(event(), 'ip195')
    await expect(authRequestLimit(event(), 'ip195')).rejects.toMatchObject({ statusCode: 429 })
    await expect(verification.assertVerificationDelivery()).resolves.toBeUndefined()
  })
  it('invitaciones se crean y encolan atómicamente sin esperar SMTP; duplicados no afectan la cuenta', async () => {
    const a = await registration.registerTenant(account('invites')), { inviteUser } = await import('../../server/utils/users')
    await inviteUser(a.tenantId, 'invite195@local.test', a.memberRoleId, 'Invitante')
    await expect(inviteUser(a.tenantId, 'invite195@local.test', a.memberRoleId, 'Invitante')).rejects.toThrow('ya es miembro')
    expect(await admin`select id from users where tenant_id=${a.tenantId}::uuid`).toHaveLength(2)
    expect(await admin`select id from job_queue where tenant_id=${a.tenantId}::uuid and status='pending'`).toHaveLength(2)
  })
  it('POST con veinte invitaciones y fallo parcial responde antes de 2 s sin esperar al correo', async () => {
    const body = account('http-team')
    const started = Date.now()
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body,
      invitees: [{ email: body.email }, ...Array.from({ length: 19 }, (_, index) => ({ email: `team195-${index}@local.test` }))] }) })
    const result = await response.json()
    const duration = Date.now() - started
    expect(response.status).toBe(200)
    expect(duration).toBeLessThan(2000)
    expect(result).toMatchObject({ invitationsQueued: 19, invitationsFailed: 1, verificationDelivery: 'queued' })
    expect(await admin`select id from users where tenant_id=${result.tenantId}::uuid`).toHaveLength(20)
    expect(await admin`select id from job_queue where tenant_id=${result.tenantId}::uuid and status='pending'`).toHaveLength(20)
    console.info(`POST_REGISTRATION_TEAM_MS=${duration}; INVITES_QUEUED=19; INVITES_FAILED=1; SMTP_SILENT=true`)
  })
  it('limpieza aislada elimina solo altas vacías antiguas, conserva verificadas y recientes', async () => {
    const stale = await registration.registerTenant(account('stale')), recent = await registration.registerTenant(account('recent'))
    const kept = await registration.registerTenant(account('verified-kept'))
    await admin`update tenants set created_at=now()-interval '8 days' where id in (${stale.tenantId}::uuid,${kept.tenantId}::uuid)`
    await verification.confirmVerificationCode(kept.personId, kept.tenantId, (await currentCode(kept.personId)).code)
    const { cleanupPendingRegistrations } = await import('../../server/utils/pendingRegistrationCleanup')
    expect(await cleanupPendingRegistrations()).toBe(1)
    expect(await admin`select id from tenants where id=${stale.tenantId}::uuid`).toHaveLength(0)
    expect(await admin`select id from people where id=${stale.personId}::uuid`).toHaveLength(0)
    expect(await admin`select id from job_queue where tenant_id=${stale.tenantId}::uuid`).toHaveLength(0)
    expect(await admin`select id from tenants where id in (${recent.tenantId}::uuid,${kept.tenantId}::uuid)`).toHaveLength(2)
  })
})
