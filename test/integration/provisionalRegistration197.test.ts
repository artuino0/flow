import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'
import { decryptSetting } from '../../server/utils/settingsCrypto'
import { mailServer195 } from '../helpers/mailServer195'

const checkoutCalls = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('stripe', () => ({ default: class {
  customers = { create: async () => ({ id: 'cus_197' }) }
  checkout = { sessions: { create: async (input: Record<string, unknown>) => { checkoutCalls.push(input); return { url: 'https://checkout.stripe.test/197' } } } }
} }))
let database: TestDb, admin: postgres.Sql, appSql: postgres.Sql, owner: postgres.Sql
let provisional: typeof import('../../server/utils/provisionalRegistration')
let queue: typeof import('../../server/utils/jobQueue')
let legacy: typeof import('../../server/utils/emailVerification')
let server: ReturnType<typeof createServer>, base: string, smtp: Awaited<ReturnType<typeof mailServer195>>
const account = (suffix: string) => ({ fullName: 'Ana Pérez', email: `pending-${suffix}@local.test`, password: 'Clave197!Segura', registrationChoice: { plan: 'agenda', interval: 'year', utm_source: 'landing' } })
const organization = (suffix: string) => ({ organizationName: 'Organización 197', slug: `org-197-${suffix}` })
async function codeFor(token: string) {
  const [row] = await admin`select id,code_hash from pending_registrations where challenge_hash=${provisional.registrationTokenHash(token)}`
  const [job] = await admin`select payload from job_queue where payload->>'pendingRegistrationId'=${row!.id} and payload->>'pendingCodeHash'=${row!.code_hash}`
  const html = decryptSetting(job!.payload.encryptedHtml)
  return { code: html.match(/letter-spacing:6px">(\d{6})/)?.[1] || '', html, row: row!, job: job! }
}
async function ready(suffix: string) {
  const start = await provisional.startProvisionalRegistration(account(suffix))
  const code = await codeFor(start.token)
  const witness = await provisional.verifyProvisionalRegistration(start.token, code.code)
  return { ...start, witness, code }
}
async function ageEmission(token: string) {
  await admin`update pending_registrations set emissions=jsonb_build_array((now()-interval '2 minutes')::text) where challenge_hash=${provisional.registrationTokenHash(token)}`
}
async function post(path: string, body: unknown, cookie = '') {
  return fetch(base + path, { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) })
}
function cookie(response: Response, name: string) { return response.headers.getSetCookie().find(value => value.startsWith(name + '='))?.split(';')[0] || '' }
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'local-provisional-registration-197'); vi.stubEnv('APP_MODE', 'saas'); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000')
  database = await createTestDb(); admin = postgres(database.adminUrl); appSql = postgres(database.appUrl); owner = postgres(database.ownerUrl)
  vi.stubEnv('APP_DATABASE_URL', database.appUrl)
  vi.stubEnv('DB_POOL_MAX', '1')
  smtp = await mailServer195(true); smtp.setMode('timeout')
  vi.stubEnv('SMTP_HOST', '127.0.0.1'); vi.stubEnv('SMTP_PORT', String(smtp.port)); vi.stubEnv('SMTP_FROM', 'Flow <sender@local.test>')
  vi.stubEnv('MAIL_PROVIDER', 'smtp'); vi.stubEnv('SMTP_USER', ''); vi.stubEnv('SMTP_PASSWORD', '')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_simulated197')
  for (const [key, value] of Object.entries(h3)) vi.stubGlobal(key, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: process.env.JWT_SECRET }))
  provisional = await import('../../server/utils/provisionalRegistration'); queue = await import('../../server/utils/jobQueue'); legacy = await import('../../server/utils/emailVerification')
  const app = h3.createApp()
  app.use('/start', (await import('../../server/api/auth/register/start.post')).default)
  app.use('/verify', (await import('../../server/api/auth/register/verify.post')).default)
  app.use('/finish', (await import('../../server/api/auth/register.post')).default)
  app.use('/api/auth/private', (await import('../../server/middleware/auth')).default)
  server = createServer(h3.toNodeListener(app)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
}, 120000)
afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  await smtp?.stop(); await admin?.end(); await appSql?.end(); await owner?.end()
  await (await import('../../server/db')).client.end({ timeout: 1 }); await database?.stop(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
})
describe('registro provisional HU-197', () => {
  it('migraciones aplicadas como propietario no superusuario; app sin privilegios especiales', async () => {
    expect((await owner`select rolsuper from pg_roles where rolname=current_user`)[0]!.rolsuper).toBe(false)
    expect((await appSql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`)[0]).toMatchObject({ rolsuper: false, rolbypassrls: false })
  })
  it('los errores SQL no filtran parámetros privados al contrato HTTP', async () => {
    await expect(provisional.publicRegistrationOperation(async () => { throw new Error('password_hash=fixture-private-value') })).rejects.toMatchObject({ statusCode: 500, statusMessage: 'No pudimos confirmar la respuesta. Reintenta para continuar tu registro.' })
    try { await provisional.publicRegistrationOperation(async () => { throw new Error('password_hash=fixture-private-value') }) }
    catch (error) { expect(String(error)).not.toContain('fixture-private-value') }
  })
  it('start HTTP <2 s con SMTP silencioso: solo pendiente y outbox cifrado; cookie httpOnly sin sesión', async () => {
    const time = Date.now(), response = await post('/start', account('http'))
    expect(response.status).toBe(200); expect(Date.now() - time).toBeLessThan(2000)
    expect(await response.json()).toEqual({ ok: true, retryAfter: 60, delivery: 'queued' })
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')
    expect(response.headers.get('set-cookie')).not.toMatch(/flow_session|flow_auth/)
    const [pending] = await admin`select * from pending_registrations where email=${account('http').email}`
    expect(pending!.password_hash).toMatch(/^\$2/); expect(pending!.code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(await admin`select id from people where email=${account('http').email}`).toHaveLength(0)
    expect(await admin`select id from tenants where email=${account('http').email}`).toHaveLength(0)
    const jobs = await admin`select tenant_id,status,payload from job_queue where payload->>'pendingRegistrationId'=${pending!.id}`
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ tenant_id: null, status: 'pending' })
    expect(jobs[0]!.payload.html).not.toMatch(/\d{6}/)
    console.info(`START_MS=${Date.now() - time}; SMTP_SILENT=true; PENDING_ONLY=true`)
    const challenge = cookie(response, provisional.CHALLENGE_COOKIE), token = challenge.split('=')[1]!
    const verified = await post('/verify', { code: (await codeFor(token)).code }, challenge)
    expect(verified.status).toBe(200)
    const witness = cookie(verified, provisional.WITNESS_COOKIE)
    const finished = await post('/finish', organization('http'), challenge + '; ' + witness)
    expect(finished.status).toBe(200); const result = await finished.json()
    expect((await admin`select onboarding_status,registration_intent from tenants where id=${result.tenantId}::uuid`)[0]).toMatchObject({ onboarding_status: 'plan_pending', registration_intent: { plan: 'agenda', interval: 'year', utm_source: 'landing' } })
    expect((await admin`select email_verified_at from people where email=${account('http').email}`)[0]!.email_verified_at).not.toBeNull()
    expect(await admin`select id from pending_registrations where email=${account('http').email}`).toHaveLength(0)
    const billing = await import('../../server/utils/billing')
    await admin`update plans set stripe_annual_price_id='price_agenda_197' where key='agenda'`
    const checkout = await billing.createStripeCheckout(result.tenantId, 'agenda', 'year')
    expect(checkout.url).toContain('stripe.test/197'); expect(checkoutCalls).toHaveLength(1)
    expect(checkoutCalls[0]!.line_items).toEqual([{ price: 'price_agenda_197', quantity: 1 }])
  })
  it('código incorrecto confirma intentos; cinco agotan; caducado y reutilizado fallan', async () => {
    const started = await provisional.startProvisionalRegistration(account('wrong')), { code } = await codeFor(started.token)
    for (let i = 0; i < 5; i++) await expect(provisional.verifyProvisionalRegistration(started.token, code === '000000' ? '111111' : '000000')).rejects.toMatchObject({ statusCode: 400 })
    await expect(provisional.verifyProvisionalRegistration(started.token, code)).rejects.toMatchObject({ statusCode: 400 })
    expect((await admin`select attempts from pending_registrations where email=${account('wrong').email}`)[0]!.attempts).toBe(5)
    const expired = await provisional.startProvisionalRegistration(account('expired'))
    await admin`update pending_registrations set code_expires_at=now()-interval '1 second' where email=${account('expired').email}`
    await expect(provisional.verifyProvisionalRegistration(expired.token, (await codeFor(expired.token)).code)).rejects.toMatchObject({ statusCode: 400 })
    const valid = await ready('once')
    await expect(provisional.verifyProvisionalRegistration(valid.token, valid.code.code)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('reenvío y cambio de correo invalidan OTP/testigo; 60 s y cinco emisiones/hora', async () => {
    const initial = await ready('change')
    await expect(provisional.resendProvisionalRegistration(initial.token)).rejects.toMatchObject({ statusCode: 429 })
    await ageEmission(initial.token)
    const codeModule = await import('../../server/utils/verificationCode')
    const nextCode = initial.code.code === '000000' ? '111111' : '000000'
    const generator = vi.spyOn(codeModule,'newVerificationCode').mockReturnValueOnce(initial.code.code).mockReturnValueOnce(nextCode)
    try { await provisional.resendProvisionalRegistration(initial.token, 'changed197@local.test') }
    finally { generator.mockRestore() }
    await expect(provisional.completeProvisionalRegistration(initial.witness, organization('change'))).rejects.toMatchObject({ statusCode: 401 })
    await expect(provisional.verifyProvisionalRegistration(initial.token, initial.code.code)).rejects.toMatchObject({ statusCode: 400 })
    const next = await codeFor(initial.token)
    const witness = await provisional.verifyProvisionalRegistration(initial.token, next.code)
    const final = await provisional.completeProvisionalRegistration(witness, organization('change'))
    expect((await admin`select email from people where id=${final.personId}::uuid`)[0]!.email).toBe('changed197@local.test')
    const many = await provisional.startProvisionalRegistration(account('many'))
    await admin`update pending_registrations set emissions=(select jsonb_agg((now()-interval '2 minutes')::text) from generate_series(1,5)) where email=${account('many').email}`
    await expect(provisional.resendProvisionalRegistration(many.token)).rejects.toMatchObject({ statusCode: 429 })
  })
  it('testigo inválido, caducado o de otro desafío no autoriza ninguna cuenta', async () => {
    await expect(provisional.completeProvisionalRegistration('', organization('empty'))).rejects.toMatchObject({ statusCode: 401 })
    await expect(provisional.completeProvisionalRegistration('foreign', organization('foreign'))).rejects.toMatchObject({ statusCode: 401 })
    const a = await ready('witness-a'), b = await ready('witness-b')
    expect(await provisional.provisionalRegistrationStatus(a.token, b.witness)).toMatchObject({ verified: false })
    await admin`update pending_registrations set witness_expires_at=now()-interval '1 second' where email=${account('witness-a').email}`
    await expect(provisional.completeProvisionalRegistration(a.witness, organization('expired'))).rejects.toMatchObject({ statusCode: 401 })
    const injection = await post('/finish', { ...organization('foreign-email'), email: account('witness-a').email }, `${provisional.WITNESS_COOKIE}=${b.witness}`)
    expect(injection.status).toBe(400)
    expect(await admin`select id from tenants where slug='org-197-foreign-email'`).toHaveLength(0)
  })
  it('el testigo no es una sesión y no permite acceder a otros endpoints de la app', async () => {
    const value = await ready('no-session')
    const response = await fetch(base + '/api/auth/private', { headers: { Cookie: `${provisional.WITNESS_COOKIE}=${value.witness}` } })
    expect(response.status).toBe(401)
  })
  it('doble envío final crea una sola organización; reintento idéntico recupera resultado, uso distinto falla', async () => {
    const readyAccount = await ready('double'), input = organization('double')
    const [a,b] = await Promise.all([provisional.completeProvisionalRegistration(readyAccount.witness, input), provisional.completeProvisionalRegistration(readyAccount.witness, input)])
    expect(a.tenantId).toBe(b.tenantId); expect(b.resumed).toBe(true)
    expect(await admin`select id from tenants where slug=${input.slug}`).toHaveLength(1)
    expect(await admin`select id from roles where tenant_id=${a.tenantId}::uuid`).toHaveLength(2)
    await expect(provisional.completeProvisionalRegistration(readyAccount.witness, organization('second'))).rejects.toMatchObject({ statusCode: 401 })
    await admin`update registration_receipts set expires_at=now()-interval '1 second' where witness_hash=${provisional.registrationTokenHash(readyAccount.witness)}`
    await expect(provisional.completeProvisionalRegistration(readyAccount.witness, input)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('invitaciones con fallo parcial se confirman con alta; fallo exterior revierte todo y conserva pendiente', async () => {
    const good = await ready('team')
    const result = await provisional.completeProvisionalRegistration(good.witness, { ...organization('team'), invitees: [{ email: account('team').email }, { email: 'team197@local.test' }] })
    expect(result).toMatchObject({ invitationsQueued: 1, invitationsFailed: 1 })
    expect(await admin`select id from users where tenant_id=${result.tenantId}::uuid`).toHaveLength(2)
    expect(await admin`select id from job_queue where tenant_id=${result.tenantId}::uuid and payload->>'purpose'='invitation'`).toHaveLength(1)
    const bad = await ready('rollback')
    await admin`create function reject_receipt197() returns trigger language plpgsql as $$ begin raise exception 'fixture rollback'; end $$`
    await admin`create trigger reject_receipt197 before insert on registration_receipts for each row execute function reject_receipt197()`
    try { await expect(provisional.completeProvisionalRegistration(bad.witness, { ...organization('rollback'), invitees: [{ email: 'rollback197@local.test' }] })).rejects.toMatchObject({ cause: { message: 'fixture rollback' } }) }
    finally { await admin`drop trigger reject_receipt197 on registration_receipts`; await admin`drop function reject_receipt197()` }
    expect(await admin`select id from tenants where slug='org-197-rollback'`).toHaveLength(0)
    expect(await admin`select id from people where email in (${account('rollback').email},'rollback197@local.test')`).toHaveLength(0)
    expect(await provisional.provisionalRegistrationStatus(bad.token,bad.witness)).toMatchObject({ verified: true })
  })
  it('correo de cuenta verificada: mismo contrato HTTP; correo dice iniciar sesión, nunca autoriza alta', async () => {
    await admin`insert into people(email,password_hash,email_verified_at) values ('existing197@local.test','!fixture',now())`
    const response = await post('/start', { ...account('existing'), email: 'existing197@local.test' })
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, retryAfter: 60, delivery: 'queued' })
    const token = cookie(response,provisional.CHALLENGE_COOKIE).split('=')[1]!, content = await codeFor(token)
    expect(content.html).toContain('Ya tienes una cuenta'); expect(content.html).not.toMatch(/\d{6}/)
    await expect(provisional.verifyProvisionalRegistration(token,'000000')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('estado permite recargar sin filtrar contraseña ni testigo; intención saneada', async () => {
    const accountReady = await ready('state')
    const status = await provisional.provisionalRegistrationStatus(accountReady.token, accountReady.witness)
    expect(status).toMatchObject({ pending: true, verified: true, fullName: 'Ana Pérez', registrationChoice: { plan: 'agenda', interval: 'year' } })
    expect(JSON.stringify(status)).not.toMatch(/password|witness|codeHash|challengeHash/)
    await provisional.clearProvisionalIntent(accountReady.token)
    expect((await provisional.provisionalRegistrationStatus(accountReady.token, accountReady.witness)).registrationChoice).toBeNull()
  })
  it('purga pendientes vencidos, conserva recientes y verificados válidos; borra outbox provisional', async () => {
    const expired = await provisional.startProvisionalRegistration(account('purge')), kept = await ready('keep'), expiredVerified = await ready('purge-verified')
    expect(Number((await admin`select extract(epoch from expires_at-verified_at)/86400 as days from pending_registrations where email=${account('purge-verified').email}`)[0]!.days)).toBe(7)
    await admin`update pending_registrations set expires_at=now()-interval '1 second' where email in (${account('purge').email},${account('purge-verified').email})`
    const [row] = await admin`select id from pending_registrations where email=${account('purge').email}`
    expect(await provisional.purgeProvisionalRegistrations()).toBe(2)
    expect(await provisional.provisionalRegistrationStatus(expired.token,'')).toEqual({ pending: false })
    expect(await admin`select id from job_queue where payload->>'pendingRegistrationId'=${row!.id}`).toHaveLength(0)
    expect(await provisional.provisionalRegistrationStatus(kept.token,kept.witness)).toMatchObject({ pending: true, verified: true })
    await expect(provisional.completeProvisionalRegistration(expiredVerified.witness,organization('purged-verified'))).rejects.toMatchObject({ statusCode:401 })
  })
  it('cola toma trabajos sin tenant y conserva aislamiento de tenant, incluso sin WHERE', async () => {
    const readyAccount = await ready('queue'), final = await provisional.completeProvisionalRegistration(readyAccount.witness, organization('queue'))
    const { withTenant } = await import('../../server/db')
    const { sql } = await import('drizzle-orm')
    expect(await withTenant(final.tenantId,tx => tx.execute(sql`select id from job_queue`))).toHaveLength(0)
    const sending = await provisional.startProvisionalRegistration(account('worker-send'))
    const sendingCode = await codeFor(sending.token)
    const jobs = await queue.claimJobs({ batchSize: 100, perTenantLimit: 100, workerId: '197' })
    expect(jobs.some(job => job.tenantId === null)).toBe(true)
    expect(jobs.filter(job => job.tenantId === null).every(job => job.kind === 'email' && job.payload.platform === true)).toBe(true)
    const handler = (await import('../../server/utils/jobHandlers')).handleEmailJob
    const obsolete = jobs.find(job => job.payload.pendingRegistrationId === readyAccount.code.row.id)!
    expect(await handler(obsolete)).toEqual({ ok: true })
    const live = jobs.find(job => job.payload.pendingRegistrationId === sendingCode.row.id)!
    smtp.setMode('success')
    expect(await handler(live)).toEqual({ ok: true })
    expect(smtp.requests).toHaveLength(1)
    expect((await admin`select delivery_id from job_queue where id=${live.id}::uuid`)[0]!.delivery_id).not.toBeNull()
    await expect(withTenant(final.tenantId,tx => tx.execute(sql`insert into job_queue(tenant_id,kind,payload) values(null,'email','{}')`))).rejects.toThrow()
  })
  it('cuentas email_pending antiguas siguen verificando OTP y enlaces ya emitidos', async () => {
    const { registerTenant } = await import('../../server/utils/registration')
    for (const method of ['otp','link']) {
      const input = { ...account('legacy-'+method), ...organization('legacy-'+method), prepareVerification: true }
      const result = await registerTenant(input)
      const [job] = await admin`select payload from job_queue where tenant_id=${result.tenantId}::uuid`
      const html = decryptSetting(job!.payload.encryptedHtml)
      const token = new URL(html.match(/https?:\/\/[^"<> ]+/)![0]!).searchParams.get('token')!
      expect(method === 'otp' ? await legacy.confirmVerificationCode(result.personId,result.tenantId,html.match(/letter-spacing:6px">(\d{6})/)![1]!) : await legacy.confirmEmailVerification(token)).toBe(true)
      expect((await admin`select onboarding_status from tenants where id=${result.tenantId}::uuid`)[0]!.onboarding_status).toBe('plan_pending')
    }
  })
})
