import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createError, createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createTestDb, type TestDb } from '../setup/testDb'
import { mailServer195 } from '../helpers/mailServer195'
import type { ClaimedJob } from '../../server/utils/jobQueue'
import { encryptSetting } from '../../server/utils/settingsCrypto'

let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db')
let queue: typeof import('../../server/utils/jobQueue'), handler: typeof import('../../server/utils/jobHandlers')
let primary: Awaited<ReturnType<typeof mailServer195>>, backup: Awaited<ReturnType<typeof mailServer195>>
const tenant = randomUUID()
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl)
  vi.stubEnv('APP_DATABASE_URL', database.appUrl)
  vi.stubEnv('JWT_SECRET', 'local-mail-queue-fixture-195')
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('createError', createError)
  vi.stubEnv('MAIL_FROM', 'Flow <sender@local.test>'); vi.stubEnv('MAIL_TIMEOUT_MS', '150')
  vi.stubEnv('MAILTRAP_API_TOKEN', 'local-key'); vi.stubEnv('MAILTRAP_INBOX_ID', 'local-inbox'); vi.stubEnv('MAILTRAP_MODE', 'sandbox')
  vi.stubEnv('RESEND_API_KEY', 'local-key'); vi.stubEnv('POSTMARK_SERVER_TOKEN', 'local-key')
  primary = await mailServer195(); backup = await mailServer195()
  const fetchLocal = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const address = String(input)
    const local = address.startsWith('https://sandbox.api.mailtrap.io/') ? primary.url + '/mailtrap'
      : address.startsWith('https://api.resend.com/') ? primary.url + '/resend'
      : address.startsWith('https://api.postmarkapp.com/') ? backup.url + '/postmark' : ''
    if (!local) throw new Error('La prueba prohíbe conexiones externas')
    return fetchLocal(local, init)
  })
  await admin`insert into tenants(id,name) values (${tenant},'Cola local 195')`
  connection = await import('../../server/db'); queue = await import('../../server/utils/jobQueue'); handler = await import('../../server/utils/jobHandlers')
}, 90000)
beforeEach(async () => {
  await admin`delete from job_queue`
  await admin`delete from tenant_email_settings where tenant_id=${tenant}`
  primary.requests.length = 0; backup.requests.length = 0
  primary.setMode('success'); backup.setMode('success')
  vi.stubEnv('MAIL_PROVIDER', 'mailtrap'); vi.stubEnv('MAIL_FALLBACK_PROVIDER', 'postmark')
})
afterAll(async () => {
  await primary?.stop(); await backup?.stop(); await connection?.client.end(); await admin?.end(); await database?.stop()
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})
async function claim(platform = true): Promise<ClaimedJob> {
  await admin`insert into job_queue(tenant_id,kind,payload,run_at) values (${tenant},'email',${admin.json({ to: 'recipient@local.test', subject: 'Cola local', html: '<p>Mensaje fijo</p>', platform })},now()-interval '1 minute')`
  return (await queue.claimJobs({ batchSize: 1, perTenantLimit: 1, workerId: 'local-195' }))[0]!
}
it('ACK durable impide reenviar aunque no se haya completado el trabajo', async () => {
  const job = await claim()
  expect(await handler.handleEmailJob(job)).toEqual({ ok: true })
  expect(await handler.handleEmailJob(job)).toEqual({ ok: true })
  expect(primary.requests).toHaveLength(1)
  expect((await admin`select delivery_provider,delivery_id from job_queue where id=${job.id}`)[0]).toMatchObject({ delivery_provider: 'mailtrap', delivery_id: 'accepted' })
})
it('rechazo transitorio pasa al respaldo en el siguiente intento; rechazo permanente no reintenta', async () => {
  const job = await claim(); primary.setMode('server')
  const failed = await handler.handleEmailJob(job)
  expect(failed).toMatchObject({ ok: false, retryable: true })
  expect(await queue.failJob(job, failed)).toBe('retry')
  await admin`update job_queue set run_at=now()-interval '1 minute' where id=${job.id}`
  const retry = (await queue.claimJobs({ batchSize: 1, perTenantLimit: 1, workerId: 'local-195' }))[0]!
  expect(await handler.handleEmailJob(retry)).toEqual({ ok: true })
  expect(backup.requests).toHaveLength(1)
  expect((await admin`select delivery_provider from job_queue where id=${job.id}`)[0]!.delivery_provider).toBe('postmark')
  primary.setMode('reject')
  expect(await handler.handleEmailJob(await claim())).toMatchObject({ ok: false, retryable: false })
})
it('timeout sin idempotencia detiene entrega ambigua y nunca envía al respaldo', async () => {
  const job = await claim(); primary.setMode('timeout')
  const failed = await handler.handleEmailJob(job)
  expect(failed).toMatchObject({ ok: false, retryable: false })
  expect(await queue.failJob(job, failed)).toBe('dead')
  expect(await queue.retryDeadJob(tenant, job.id)).toBe(false)
  expect(backup.requests).toHaveLength(0)
})
it('Resend reintenta con la misma clave, cuerpo y proveedor; conserva inicio y expira a las 23 h', async () => {
  vi.stubEnv('MAIL_PROVIDER', 'resend')
  const job = await claim(); primary.setMode('timeout')
  expect(await handler.handleEmailJob(job)).toMatchObject({ ok: false, retryable: true })
  const first = (await admin`select delivery_started_at from job_queue where id=${job.id}`)[0]!.delivery_started_at
  primary.setMode('success')
  expect(await handler.handleEmailJob({ ...job, attempts: 2 })).toEqual({ ok: true })
  expect(primary.requests.map(request => request.headers['idempotency-key'])).toEqual([job.id, job.id])
  expect(primary.requests[0]!.body).toBe(primary.requests[1]!.body)
  expect((await admin`select delivery_started_at from job_queue where id=${job.id}`)[0]!.delivery_started_at).toEqual(first)
  expect(backup.requests).toHaveLength(0)
  await admin`update job_queue set delivery_id=null,delivery_started_at=now()-interval '24 hours' where id=${job.id}`
  expect(await handler.handleEmailJob({ ...job, attempts: 3 })).toMatchObject({ ok: false, retryable: false })
  expect(primary.requests).toHaveLength(2)
})
it('recuperación de proceso caído distingue ACK, ambigüedad y ventana idempotente', async () => {
  const ack = await claim(), unknown = await claim(), safe = await claim()
  await admin`update job_queue set locked_at=now()-interval '20 minutes',delivery_started_at=now()-interval '20 minutes',delivery_provider='mailtrap'`
  await admin`update job_queue set delivery_id='accepted' where id=${ack.id}`
  await admin`update job_queue set delivery_provider='resend' where id=${safe.id}`
  expect(await queue.recoverStuckJobs()).toBe(3)
  const rows = await admin`select id,status from job_queue`
  expect(rows.find(row => row.id === ack.id)!.status).toBe('pending')
  expect(rows.find(row => row.id === unknown.id)!.status).toBe('dead')
  expect(rows.find(row => row.id === safe.id)!.status).toBe('pending')
})
it('cambiar credenciales tras un timeout no borra la ambigüedad ni habilita un reenvío manual', async () => {
  vi.stubEnv('MAIL_PROVIDER', 'resend')
  const job = await claim(); primary.setMode('timeout')
  expect(await handler.handleEmailJob(job)).toMatchObject({ ok: false, retryable: true })
  const first = (await admin`select delivery_started_at from job_queue where id=${job.id}`)[0]!.delivery_started_at
  vi.stubEnv('RESEND_API_KEY', '')
  const failed = await handler.handleEmailJob({ ...job, attempts: 2 })
  expect(failed).toMatchObject({ ok: false, retryable: false })
  await queue.failJob(job, failed)
  expect((await admin`select delivery_started_at from job_queue where id=${job.id}`)[0]!.delivery_started_at).toEqual(first)
  expect(await queue.retryDeadJob(tenant, job.id)).toBe(false)
  expect(backup.requests).toHaveLength(0)
  vi.stubEnv('RESEND_API_KEY', 'local-key')
})
it('diagnóstico y prueba exigen administrador; health no divulga configuración ni secretos', async () => {
  const status = (await import('../../server/api/platform/mail.get')).default
  const test = (await import('../../server/api/platform/mail/test.post')).default
  const health = (await import('../../server/api/health.get')).default
  const event = () => createEvent(new IncomingMessage(new Socket()), new ServerResponse(new IncomingMessage(new Socket())))
  await expect(status(event())).rejects.toMatchObject({ statusCode: 401 })
  await expect(test(event())).rejects.toMatchObject({ statusCode: 401 })
  const role = (await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`)[0]!.id
  const person = (await admin`insert into people(email,password_hash,full_name) values ('platform195@local.test','x','Administrador local') returning id`)[0]!.id
  const user = (await admin`insert into users(tenant_id,role_id,person_id) values (${tenant},${role},${person}) returning id`)[0]!.id
  const authorized = event(); authorized.context.auth = { sub: user, tenantId: tenant, roleId: role }
  vi.stubEnv('PLATFORM_ADMIN_EMAILS', '')
  await expect(status(authorized)).rejects.toMatchObject({ statusCode: 403 })
  await expect(test(authorized)).rejects.toMatchObject({ statusCode: 403 })
  vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'platform195@local.test')
  const diagnostic = await status(authorized)
  expect(diagnostic).toMatchObject({ provider: 'mailtrap', status: 'ok' })
  expect(JSON.stringify(diagnostic)).not.toContain('local-key')
  expect(await test(authorized)).toMatchObject({ ok: true, provider: 'mailtrap', durationMs: expect.any(Number) })
  const publicHealth = await health(event())
  expect(publicHealth).toMatchObject({ mail: 'ok' })
  expect(JSON.stringify(publicHealth)).not.toMatch(/sender|mailtrap|local-key/)
  vi.stubEnv('MAILTRAP_API_TOKEN', '')
  expect(await health(event())).toMatchObject({ mail: 'misconfigured' })
})
it('una organización que configura SMTP tras un timeout no cambia la entrega incierta de proveedor', async () => {
  vi.stubEnv('MAIL_PROVIDER', 'resend')
  const job = await claim(false); primary.setMode('timeout')
  expect(await handler.handleEmailJob(job)).toMatchObject({ ok: false, retryable: true })
  await admin`insert into tenant_email_settings(tenant_id,provider,host,port,username,password_encrypted,from_email,security)
    values (${tenant},'smtp','127.0.0.1',2525,'local',${encryptSetting('local-password')},'sender@local.test','none')`
  const failed = await handler.handleEmailJob({ ...job, attempts: 2 })
  expect(failed).toMatchObject({ ok: false, retryable: false })
  expect(primary.requests).toHaveLength(1)
  expect(backup.requests).toHaveLength(0)
  expect((await admin`select delivery_started_at from job_queue where id=${job.id}`)[0]!.delivery_started_at).toBeTruthy()
})
