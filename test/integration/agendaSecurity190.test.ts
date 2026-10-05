import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { agendaFormToken, agendaHash, agendaOpaqueId } from '../../server/utils/agendaPublicSecurity'
import { agendaSiteSettingsSchema, publicBookSchema } from '../../utils/agendaPublic'
import type { AuthTokenPayload } from '../../server/utils/auth'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
const { send, trigger } = vi.hoisted(() => ({ send: vi.fn(async (_payload: { to: string }) => {}), trigger: vi.fn() }))
vi.mock('../../server/utils/mailer', async original => ({ ...await original<typeof import('../../server/utils/mailer')>(), sendPlainEmail: send }))
vi.mock('../../server/utils/triggers', () => ({ fireTriggersForRecord: trigger }))
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db'), api: typeof import('../../server/utils/agendaPublic'), security: typeof import('../../server/utils/agendaPersistentLimit')
const tenant = randomUUID(), site = randomUUID(), page = randomUUID(), otherSite = randomUUID(), otherPage = randomUUID()
const now = Date.parse('2026-10-04T12:00:00Z'), origin = { origin: 'http://localhost:3000', host: 'localhost:3000', ip: '198.51.100.8', userAgent: '' }
let staff: string, adminId: string, role: string, service: string, auth: AuthTokenPayload, context: import('../../server/utils/agendaPublic').PublicAgendaContext
const actor = <T>(fn: () => Promise<T>) => withRecordActor({ userId: adminId, roleId: role }, fn)
const input = (time: string, email = randomUUID() + '@example.test', at = now) => publicBookSchema.parse({ site, page, services: [agendaOpaqueId(site, 'service', service)], date: '2026-10-05', time, personal: agendaOpaqueId(site, 'person', staff), client: { name: 'Visitante 190', email }, formToken: agendaFormToken(site, page, at - 3000) })
async function config(change: Record<string, unknown>) {
  const [row] = await admin`select config from agenda_site_settings where site_id=${site}`
  await actor(() => api.agendaSiteAdministration(auth, site, { ...row!.config, ...change }))
}
async function confirmationToken(email: string) {
  const [job] = await admin`select payload from job_queue where tenant_id=${tenant} and kind='email' and payload->>'to'=${email} and payload->>'subject'='Confirma tu cita' order by created_at desc limit 1`
  const match = String(job!.payload.text).match(/#confirm=([A-Za-z0-9_-]{43})/)
  expect(match).not.toBeNull(); return match![1]!
}
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = origin.origin
  await admin`insert into tenants(id,name,slug) values (${tenant},'Agenda seguridad',${tenant})`
  role = (await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`)[0]!.id
  const staffRole = (await admin`insert into roles(tenant_id,name) values (${tenant},'Personal') returning id`)[0]!.id
  for (const roleId of [role, staffRole]) {
    const person = (await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@example.test'},'x','Persona 190') returning id`)[0]!.id
    const user = (await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person},${roleId}) returning id`)[0]!.id
    if (roleId === role) adminId = user; else staff = user
  }
  auth = { sub: adminId, roleId: role, tenantId: tenant } as AuthTokenPayload
  connection = await import('../../server/db'); api = await import('../../server/utils/agendaPublic'); security = await import('../../server/utils/agendaPersistentLimit')
  await (await import('../../server/utils/agendaTemplate')).installAgendaTemplate(tenant)
  service = (await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-servicios'),'{"nombre":"Consulta","duracion_minutos":30,"precio":100}') returning id`)[0]!.id
  for (const [sid, pid] of [[site, page], [otherSite, otherPage]]) {
    await admin`insert into sites(id,tenant_id,name,slug,status) values (${sid!},${tenant},'Sitio',${sid!},'published')`
    await admin`insert into site_pages(id,tenant_id,site_id,title,path,status) values (${pid!},${tenant},${sid!},'Inicio','/','published')`
    const version = (await admin`insert into site_page_versions(tenant_id,site_id,page_id,version,status,html) values (${tenant},${sid!},${pid!},1,'published','<h1>Agenda</h1>') returning id`)[0]!.id
    await admin`update site_pages set published_version_id=${version} where id=${pid!}`
    await actor(() => api.agendaSiteAdministration(auth, sid!, { enabled: true, personalIds: [staff], cancellationHours: 0, confirmEmail: sid === site }))
  }
  context = await api.resolveAgendaContext(site, page, origin)
}, 120000)
afterAll(async () => { await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; delete process.env.APP_BASE_URL })
it('migración no superusuario, ACL cerrada, nueva RLS y FK cascade', async () => {
  const owner = postgres(database.ownerUrl, { onnotice: () => {} })
  try {
    expect((await owner`select current_setting('is_superuser') as value`)[0]!.value).toBe('off')
    const [fn] = await owner`select pg_get_userbyid(proowner) as owner,proconfig,proacl::text as acl from pg_proc where proname='purge_agenda_security_buckets'`
    expect(fn).toMatchObject({ owner: 'erp_owner', proconfig: ['search_path=public'] }); expect(fn!.acl).not.toMatch(/[{,]=X/)
    const [fk] = await owner`select confdeltype from pg_constraint where conrelid='agenda_security_buckets'::regclass and contype='f'`; expect(fk!.confdeltype).toBe('c')
    const plain = postgres(database.appUrl); try { expect(await plain`select * from agenda_security_buckets`).toHaveLength(0) } finally { await plain.end() }
    expect(readFileSync('server/db/migrations/0098_agenda_security.sql', 'utf8')).not.toMatch(/SET\s+(app|flow)\./i)
  } finally { await owner.end() }
})
it('límite persiste en nuevo proceso, suma concurrencia real y guarda solo claves opacas', async () => {
  const key = 'ip:198.51.100.99:correo@example.test'
  const results = await Promise.all(Array.from({ length: 10 }, () => security.consumeAgendaBucket(tenant, key, 900, now)))
  expect(results.map(value => value.attempts).sort((a,b) => a-b)).toEqual([1,2,3,4,5,6,7,8,9,10])
  const rows = await admin`select key_hash,attempts from agenda_security_buckets where tenant_id=${tenant} and key_hash=${security.agendaPrivateKey(key)}`
  expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain('198.51.100'); expect(JSON.stringify(rows)).not.toContain('@')
  const program = "import postgres from 'postgres'; const sql=postgres(process.env.AGENDA_TEST_URL); const rows=await sql`select attempts from agenda_security_buckets where tenant_id=${process.env.AGENDA_TEST_TENANT}::uuid and key_hash=${process.env.AGENDA_TEST_KEY}`; if(rows[0]?.attempts!==10) process.exitCode=1; await sql.end();"
  const exit = await new Promise<number>(resolve => { const child = spawn(process.execPath, ['--input-type=module', '-e', program], { windowsHide: true, stdio: 'ignore', env: { ...process.env, AGENDA_TEST_URL: database.adminUrl, AGENDA_TEST_TENANT: tenant, AGENDA_TEST_KEY: security.agendaPrivateKey(key) } }); child.on('exit', code => resolve(code ?? 1)) })
  expect(exit).toBe(0)
  expect((await security.consumeAgendaBucket(tenant, key, 900, now + 900000)).attempts).toBe(1)
  await admin`select purge_agenda_security_buckets(${new Date(now + 1800001)})`
  expect(await admin`select * from agenda_security_buckets where key_hash=${security.agendaPrivateKey(key)}`).toHaveLength(0)
})
it('dos visitantes del mismo proxy tienen cuotas independientes; el atacante queda limitado', async () => {
  const first = await api.resolveAgendaContext(site, page, { ...origin, ip: '198.51.100.11' }), second = await api.resolveAgendaContext(site, page, { ...origin, ip: '198.51.100.12' })
  for (let n=0;n<10;n++) await security.persistentAgendaLimit(first, 'book-isolation', [], false, now)
  await expect(security.persistentAgendaLimit(first, 'book-isolation', [], false, now)).rejects.toMatchObject({ statusCode: 429 })
  await expect(security.persistentAgendaLimit(second, 'book-isolation', [], false, now)).resolves.toBeUndefined()
})
it('por confirmar ocupa horario, cuenta contacto y solo manda correo al visitante; confirma una vez', async () => {
  send.mockClear(); trigger.mockClear()
  const body = input('09:00', 'pending190@example.test'), result = await api.publicAgendaBook(context, body, now)
  expect(result).toMatchObject({ pending: true, token: '' }); expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]![0].to).toBe(body.client.email); expect(trigger).not.toHaveBeenCalled()
  const token = await confirmationToken(body.client.email)
  const [booking] = await admin`select * from agenda_public_bookings where confirmation_hash=${agendaHash(token)}`
  expect(booking!.confirmation_state).toBe('pending'); expect(JSON.stringify(booking)).not.toContain(token)
  expect((await admin`select custom_data from records where id=${booking!.record_id}`)[0]!.custom_data.estado).toBe('por_confirmar')
  await expect(api.publicAgendaBook(context, input('09:00'), now)).rejects.toMatchObject({ statusCode: 409 })
  await config({ maxActiveBookings: 1 }); await expect(api.publicAgendaBook(context, input('09:30', body.client.email), now)).rejects.toMatchObject({ statusCode: 429 }); await config({ maxActiveBookings: 3 })
  await expect(api.publicAgendaConfirm(context, token.slice(0,-1) + (token.endsWith('A') ? 'B' : 'A'), now)).rejects.toMatchObject({ statusCode: 404 })
  const otherContext = await api.resolveAgendaContext(otherSite, otherPage, origin); await expect(api.publicAgendaConfirm(otherContext, token, now)).rejects.toMatchObject({ statusCode: 404 })
  const confirmations = await Promise.all([api.publicAgendaConfirm(context, token, now + 3000), api.publicAgendaConfirm(context, token, now + 3000)])
  expect(confirmations.filter(value => 'alreadyConfirmed' in value)).toHaveLength(1)
  expect(send).toHaveBeenCalledTimes(3); expect(trigger).toHaveBeenCalledTimes(1); expect(trigger.mock.calls[0]![2]).toBe('on_create')
  expect((await admin`select custom_data from records where id=${booking!.record_id}`)[0]!.custom_data.estado).toBe('agendada')
  const accepted = confirmations.find(value => 'token' in value)!
  if (!('token' in accepted)) throw new Error('Falta gestión')
  await expect(api.publicAgendaBooking(context, accepted.token, now + 4000)).resolves.toMatchObject({ time: '09:00' })
})
it('expira idempotentemente, libera el hueco y rechaza el enlace vencido y otra entrega al mismo contacto/hueco', async () => {
  const email = 'expires190@example.test'; await api.publicAgendaBook(context, input('10:00', email), now)
  const token = await confirmationToken(email), expiration = await import('../../server/utils/agendaConfirmation')
  expect(await expiration.expireAgendaConfirmations(tenant, now + 900001)).toBe(1); expect(await expiration.expireAgendaConfirmations(tenant, now + 900002)).toBe(0)
  await expect(api.publicAgendaConfirm(context, token, now + 900003)).rejects.toMatchObject({ statusCode: 410 })
  await expect(api.publicAgendaBook(context, input('10:00', email, now + 900004), now + 900004)).rejects.toMatchObject({ statusCode: 429 })
  const another = await api.publicAgendaBook(context, input('10:00', 'new190@example.test', now + 900005), now + 900005)
  expect(another).toMatchObject({ pending: true })
})
it('opción apagada conserva agendada, gestión y avisos originales; correo es requisito para activarla', async () => {
  await expect(config({ confirmEmail: true, requiredFields: ['phone'], visibleFields: ['phone'] })).rejects.toBeDefined()
  await config({ confirmEmail: false }); send.mockClear(); trigger.mockClear()
  const result = await api.publicAgendaBook(context, input('11:00'), now)
  expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect('pending' in result).toBe(false); expect(send).toHaveBeenCalledTimes(2); expect(trigger.mock.calls[0]![2]).toBe('on_create')
})
it('cola expira la reserva y dos visitantes compiten por el horario liberado sin doble reserva', async () => {
  await config({ confirmEmail: true }); await api.publicAgendaBook(context, input('12:00'), now)
  const queue = await import('../../server/utils/jobQueue'), handlers = await import('../../server/utils/jobHandlers')
  handlers.registerDefaultJobHandlers()
  await queue.runJobQueueTick({ now: () => new Date(now + 900001), budgetMs: 5000, ratePerSecond: 0 })
  const outcomes = await Promise.allSettled([api.publicAgendaBook(context, input('12:00', 'race1@example.test', now + 900002), now + 900002), api.publicAgendaBook(context, input('12:00', 'race2@example.test', now + 900002), now + 900002)])
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  const rejected = outcomes.find(outcome => outcome.status === 'rejected')
  expect(rejected && rejected.status === 'rejected' ? rejected.reason : null).toMatchObject({ statusCode: 409 })
  const tasks = await admin`select status from job_queue where tenant_id=${tenant} and kind='agenda_expire'`
  expect(tasks.some(task => task.status === 'succeeded')).toBe(true)
})
it('book integra validación Turnstile simulada y reclama cada token una vez entre peticiones', async () => {
  await config({ confirmEmail: false, botProtection: 'always' })
  vi.stubEnv('TURNSTILE_SITE_KEY', 'local-public190'); vi.stubEnv('TURNSTILE_SECRET_KEY', 'local-private190')
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: false }))); vi.stubGlobal('fetch', fetch)
  try {
    await expect(api.publicAgendaBook(context, { ...input('13:00'), turnstileToken: 'invalid190' }, now)).rejects.toMatchObject({ statusCode: 422 })
    fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, hostname: 'localhost', action: 'book' })))
    const result = await api.publicAgendaBook(context, { ...input('13:00'), turnstileToken: 'valid190' }, now)
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await expect(api.publicAgendaBook(context, { ...input('13:30'), turnstileToken: 'valid190' }, now)).rejects.toMatchObject({ statusCode: 422 }); expect(fetch).toHaveBeenCalledTimes(2)
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
})
it('handlers reales reservan por confirmar y aceptan POST de confirmación sin sesión, sin exponer el token en URL', async () => {
  await config({ confirmEmail: true, botProtection: 'automatic' }); vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    const book = (await import('../../server/api/public/agenda/book.post')).default, confirm = (await import('../../server/api/public/agenda/confirm.post')).default
    const event = (path: string, body: unknown) => {
      const socket = new Socket(); Object.defineProperty(socket, 'remoteAddress', { value: '198.51.100.190' })
      const req = new IncomingMessage(socket); req.url = path; req.method = 'POST'; req.headers = { host: origin.host, origin: origin.origin, 'content-type': 'application/json' }; req.push(JSON.stringify(body)); req.push(null)
      return createEvent(req, new ServerResponse(req))
    }
    const email = 'http190@example.test', reserved = event('/api/public/agenda/book', input('14:00', email))
    expect(await book(reserved)).toMatchObject({ pending: true, token: '' }); expect(reserved.node.res.statusCode).toBe(201)
    const token = await confirmationToken(email), request = event('/api/public/agenda/confirm', { site, page, token })
    expect(await confirm(request)).toHaveProperty('token'); expect(request.node.req.url).not.toContain(token); expect(request.node.res.getHeader('cache-control')).toBe('no-store'); expect(request.node.res.getHeader('set-cookie')).toBeUndefined()
    await expect(confirm(event('/api/public/agenda/confirm', { site, page, token: 'alterado' }))).rejects.toMatchObject({ statusCode: 404, stack: '' })
  } finally { vi.restoreAllMocks() }
})
it('un contacto no recibe dos confirmaciones para el mismo horario aunque cambie de profesional', async () => {
  const person = (await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@example.test'},'x','Segunda persona 190') returning id`)[0]!.id
  const staffRole = (await admin`select id from roles where tenant_id=${tenant} and name='Personal'`)[0]!.id
  const second = (await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person},${staffRole}) returning id`)[0]!.id
  await admin`insert into agenda_schedules(tenant_id,user_id,weekday,start_time,end_time) values (${tenant},${second},1,'09:00','18:00')`
  await config({ confirmEmail: true, personalIds: [staff, second] })
  const email = 'same-slot190@example.test'; await api.publicAgendaBook(context, input('15:00', email), now)
  await expect(api.publicAgendaBook(context, { ...input('15:00', email), personal: agendaOpaqueId(site, 'person', second) }, now)).rejects.toMatchObject({ statusCode: 429 })
  expect(await admin`select id from job_queue where tenant_id=${tenant} and kind='email' and payload->>'subject'='Confirma tu cita' and payload->>'to'=${email}`).toHaveLength(1)
})
