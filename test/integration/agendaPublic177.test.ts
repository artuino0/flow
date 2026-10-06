import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { drainEmails195 } from '../helpers/drainEmails195'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { agendaSiteSettingsSchema, publicBookSchema } from '../../utils/agendaPublic'
import { agendaFormToken, agendaHash, agendaOpaqueId } from '../../server/utils/agendaPublicSecurity'
import type { AuthTokenPayload } from '../../server/utils/auth'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { resetPublicRateLimits } from '../../server/utils/rateLimit'
import { readFileSync } from 'node:fs'
const { sendPlainEmail } = vi.hoisted(() => ({ sendPlainEmail: vi.fn(async (_payload: { to: string }) => {}) }))
vi.mock('../../server/utils/mailer', async original => ({ ...await original<typeof import('../../server/utils/mailer')>(), sendPlainEmail }))
vi.mock('../../server/utils/triggers', () => ({ fireTriggersForRecord: vi.fn() }))
let database: TestDb, admin: postgres.Sql, app: postgres.Sql, connection: typeof import('../../server/db'), api: typeof import('../../server/utils/agendaPublic')
const tenant = randomUUID(), other = randomUUID(), site = randomUUID(), page = randomUUID(), otherSite = randomUUID(), otherPage = randomUUID()
const now = Date.parse('2026-10-04T12:00:00Z'), origin = { origin: 'http://localhost:3000', host: 'localhost:3000', ip: '127.0.0.1', userAgent: 'Test local' }
let staff: string, adminId: string, role: string, staffRole: string, service: string, base: string, clientEntity: string, auth: AuthTokenPayload
let context: import('../../server/utils/agendaPublic').PublicAgendaContext
const actor = <T>(fn: () => Promise<T>) => withRecordActor({ userId: adminId, roleId: role }, fn)
const input = (time: string, email = randomUUID() + '@test.local') => publicBookSchema.parse({ site, page, services: [agendaOpaqueId(site, 'service', service)], date: '2026-10-05', time, personal: agendaOpaqueId(site, 'person', staff), client: { name: 'Ana pública', email, phone: '' }, formToken: agendaFormToken(site, page, now - 3000) })
async function setConfig(change: Record<string, unknown>) {
  const [row] = await admin`select config from agenda_site_settings where site_id=${site}`
  await admin`update agenda_site_settings set config=${admin.json(agendaSiteSettingsSchema.parse({ ...row!.config, ...change }))} where site_id=${site}`
}
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} }); app = postgres(database.appUrl, { max: 20, onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = origin.origin
  for (const id of [tenant, other]) await admin`insert into tenants(id,name,slug) values (${id},'Agenda pública',${'agenda177-' + id})`
  const [ar] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`; role = ar!.id
  const [sr] = await admin`insert into roles(tenant_id,name) values (${tenant},'Personal') returning id`; staffRole = sr!.id
  for (const [roleId, name] of [[role, 'Administrador privado'], [staffRole, 'Ana visible']] as const) {
    const [person] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x',${name}) returning id`
    const [user] = await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person!.id},${roleId}) returning id`
    if (roleId === role) adminId = user!.id; else staff = user!.id
  }
  auth = { sub: adminId, tenantId: tenant, roleId: role } as AuthTokenPayload
  connection = await import('../../server/db'); api = await import('../../server/utils/agendaPublic')
  const template = await import('../../server/utils/agendaTemplate'); await template.installAgendaTemplate(tenant)
  base = (await admin`select id from entities where tenant_id=${tenant} and slug='agenda-citas'`)[0]!.id
  clientEntity = (await admin`select id from entities where tenant_id=${tenant} and slug='agenda-clientes'`)[0]!.id
  service = (await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-servicios'),' {"nombre":"Consulta","duracion_minutos":30,"precio":100}') returning id`)[0]!.id
  for (const [sid, pid, tid] of [[site, page, tenant], [otherSite, otherPage, other]] as const) {
    await admin`insert into sites(id,tenant_id,name,slug,status) values (${sid},${tid},'Sitio publicado',${'site-' + sid},'published')`
    await admin`insert into site_pages(id,tenant_id,site_id,path,title,status) values (${pid},${tid},${sid},'/','Inicio','published')`
    const [version] = await admin`insert into site_page_versions(tenant_id,site_id,page_id,version,status,html) values (${tid},${sid},${pid},1,'published','<p>Prueba</p>') returning id`
    await admin`update site_pages set published_version_id=${version!.id} where id=${pid}`
  }
  await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, personalIds: [staff], cancellationHours: 1 }))
  await admin`insert into agenda_site_settings(tenant_id,site_id,config) values (${other},${otherSite},'{"enabled":true}')`
  context = await api.resolveAgendaContext(site, page, origin)
  const original = api
  api = { ...original,
    publicAgendaBook: async (...args) => { const result = await original.publicAgendaBook(...args); await drainEmails195(admin); return result },
    publicAgendaManage: async (...args) => { const result = await original.publicAgendaManage(...args); await drainEmails195(admin); return result }
  }
}, 90000)
afterAll(async () => { await connection?.client.end(); await app?.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; delete process.env.APP_BASE_URL })
describe('Agenda pública 177 con PostgreSQL real y SMTP simulado', () => {
  it('0094 está aplicada en base local de pruebas y registrada en el journal de fuentes', async () => {
    const target = new URL(database.adminUrl)
    expect(['localhost', '127.0.0.1']).toContain(target.hostname)
    expect(target.pathname).not.toBe('/erp_dinamico')
    const tables = await admin`select tablename,rowsecurity from pg_tables where tablename in ('agenda_site_settings','agenda_public_bookings') order by tablename`
    expect(tables).toHaveLength(2); expect(tables.every(table => table.rowsecurity)).toBe(true)
    const policies = await admin`select tablename from pg_policies where tablename in ('agenda_site_settings','agenda_public_bookings')`
    expect(policies).toHaveLength(2)
    const journal = JSON.parse(readFileSync(new URL('../../server/db/migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { idx: number; tag: string }[] }
    expect(journal.entries.find(entry => entry.idx === 94)?.tag).toBe('0094_agenda_public')
    const migration = readFileSync(new URL('../../server/db/migrations/0094_agenda_public.sql', import.meta.url), 'utf8')
    console.info(`MIGRACION_LOCAL=0094_agenda_public HOST=${target.hostname} PORT=${target.port} BD=${target.pathname.slice(1)} SHA256=${agendaHash(migration)} RLS=2 POLICIES=2`)
  })
  it('rechaza sitio/página sin publicar, agenda apagada, página ajena y origen falso con el mismo 404', async () => {
    const reject = async (sid = site, pid = page, request = origin) => expect(api.resolveAgendaContext(sid, pid, request)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
    await reject(site, otherPage)
    await reject(randomUUID(), page)
    await reject(site, page, { ...origin, origin: 'https://evil.test' })
    await reject(site, page, { ...origin, origin: 'https://evil.test', host: 'evil.test' })
    await admin`update site_pages set status='draft' where id=${page}`; await reject(); await admin`update site_pages set status='published' where id=${page}`
    await admin`update sites set status='draft' where id=${site}`; await reject(); await admin`update sites set status='published' where id=${site}`
    await setConfig({ enabled: false }); await reject(); await setConfig({ enabled: true })
    await expect(api.publicAgendaSlots(await api.resolveAgendaContext(otherSite, otherPage, origin), { from: '2026-10-05', to: '2026-10-05' }, now)).rejects.toMatchObject({ statusCode: 404 })
  })
  it('administración valida permiso, tenant, servicios, Personal y Citas/horarios', async () => {
    await expect(actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, serviceIds: [randomUUID()] }))).rejects.toMatchObject({ statusCode: 422 })
    await expect(actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, personalIds: [adminId] }))).resolves.toMatchObject({ settings: { personalIds: [adminId] } })
    await expect(actor(() => api.agendaSiteAdministration(auth, otherSite))).rejects.toMatchObject({ statusCode: 404 })
    const personal = { ...auth, sub: staff, roleId: staffRole }
    await expect(withRecordActor({ userId: staff, roleId: staffRole }, () => api.agendaSiteAdministration(personal, site))).rejects.toMatchObject({ statusCode: 403 })
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, serviceIds: [service], personalIds: [staff], cancellationHours: 1 }))
  })
  it('slots contiene solo huecos libres, zona y catálogo visible sin correos ni IDs de registros/usuarios', async () => {
    const result = await api.publicAgendaSlots(context, { from: '2026-10-05', to: '2026-10-05' }, now)
    expect(result.slots.length).toBeGreaterThan(0)
    expect(result.people).toEqual([{ id: agendaOpaqueId(site, 'person', staff), name: 'Ana visible' }])
    expect(result.services).toEqual([{ id: agendaOpaqueId(site, 'service', service), name: 'Consulta', duration: 30 }])
    const text = JSON.stringify(result)
    for (const forbidden of [staff, adminId, service, base, clientEntity, 'Administrador privado', '@test.local', 'customData', 'userId']) expect(text).not.toContain(forbidden)
    expect(result.slots.every(slot => slot.timezone === 'America/Mexico_City')).toBe(true)
    await expect(api.publicAgendaSlots(context, { from: '2026-10-05', to: '2027-10-05' }, now)).rejects.toMatchObject({ statusCode: 422 })
    await setConfig({ assignmentMode: 'auto' })
    const automatic = await api.publicAgendaSlots(context, { from: '2026-10-05', to: '2026-10-05' }, now)
    expect(automatic.people).toEqual([]); expect(automatic.slots).toEqual([]); expect(automatic.automatic.every(slot => slot.personal === 'any' && !('name' in slot))).toBe(true)
    await setConfig({ assignmentMode: null })
  })
  it('reserva feliz crea Cliente y cita agendada; token solo hash y confirmación sin PII ajena', async () => {
    const body = input('09:00', 'ana@example.test'), result = await api.publicAgendaBook(context, body, now)
    expect(result).toMatchObject({ date: body.date, time: body.time, personal: 'Ana visible', services: ['Consulta'] })
    const [booking] = await admin`select * from agenda_public_bookings where token_hash=${agendaHash(result.token)}`
    expect(booking!.token_hash).not.toBe(result.token); expect(JSON.stringify(booking)).not.toContain(result.token)
    const [record] = await admin`select custom_data from records where id=${booking!.record_id}`
    expect(record!.custom_data).toMatchObject({ estado: 'agendada', personal: staff })
    const lines = await admin`select r.custom_data from records r join entities e on e.id=r.entity_id where e.tenant_id=${tenant} and e.slug='agenda-servicios-cita' and r.custom_data->>'cita'=${booking!.record_id} and r.deleted_at is null`
    expect(lines).toHaveLength(1); expect(lines[0]!.custom_data).toMatchObject({ servicio: service, importe: '100' })
    const [client] = await admin`select custom_data from records where id=${record!.custom_data.cliente}`
    expect(client!.custom_data).toMatchObject({ nombre: 'Ana pública', correo: 'ana@example.test' })
    const confirmation = await api.publicAgendaBooking(context, result.token, now)
    expect(confirmation).toEqual({ date: body.date, time: body.time, timezone: 'America/Mexico_City', personal: 'Ana visible', services: ['Consulta'] })
    expect(JSON.stringify(confirmation)).not.toContain('ana@example.test')
    const jobs = await admin`select payload,status from job_queue where tenant_id=${tenant}`
    expect(jobs).toHaveLength(2); expect(sendPlainEmail).toHaveBeenCalledTimes(2)
    const mail = jobs.find(job => job.payload.to === 'ana@example.test')!.payload
    expect(mail.html).toContain('09:00'); expect(mail.html).toContain('Consulta'); expect(mail.html).toContain('Ana visible'); expect(mail.html).toContain(`/agenda-manage/${site}/${page}#agenda=${result.token}`)
    expect(mail.html).not.toContain(adminId); expect(mail.html).not.toContain('Administrador privado')
    expect(await admin`select id from record_activities where record_id=${booking!.record_id} and details->>'source'='Sitio web'`).toHaveLength(1)
  })
  it('reutiliza cliente por correo normalizado sin pisar nombre ni teléfono', async () => {
    const result = await api.publicAgendaBook(context, { ...input('09:30', 'ana@example.test'), client: { name: 'Nombre no confiable', email: 'ana@example.test', phone: '' } }, now)
    expect(result.time).toBe('09:30')
    const clients = await admin`select custom_data from records where entity_id=${clientEntity} and custom_data->>'correo'='ana@example.test'`
    expect(clients).toHaveLength(1); expect(clients[0]!.custom_data.nombre).toBe('Ana pública')
  })
  it('20 reservas paralelas en un hueco: 1 éxito y 19 conflictos; sin clientes huérfanos', async () => {
    const before = (await admin`select count(*)::int n from records where entity_id=${clientEntity}`)[0]!.n
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => api.publicAgendaBook(context, input('10:00'), now)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 409 })
    expect((await admin`select count(*)::int n from records where entity_id=${clientEntity}`)[0]!.n).toBe(before + 1)
    expect(await admin`select id from records where entity_id=${base} and custom_data->>'hora'='10:00'`).toHaveLength(1)
  }, 60000)
  it('tope configurable de tres citas futuras por correo, incluso con peticiones paralelas', async () => {
    await api.publicAgendaBook(context, input('10:30', 'ana@example.test'), now)
    await expect(api.publicAgendaBook(context, input('11:00', 'ana@example.test'), now)).rejects.toMatchObject({ statusCode: 429 })
    const results = await Promise.allSettled(['11:00', '11:30', '12:00', '12:30'].map(time => api.publicAgendaBook(context, input(time, 'limit@test.local'), now)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })
  it('honeypot, llenado rápido y consentimiento no crean registros', async () => {
    for (const body of [{ ...input('13:00'), _flow_honeypot: 'bot' }, { ...input('13:00'), formToken: agendaFormToken(site, page, now) }]) await expect(api.publicAgendaBook(context, body, now)).rejects.toMatchObject({ statusCode: 422 })
    await setConfig({ requireConsent: true })
    await expect(api.publicAgendaBook(context, input('13:00'), now)).rejects.toMatchObject({ statusCode: 422 })
    await api.publicAgendaBook(context, { ...input('13:00'), consent: true }, now)
    await setConfig({ requireConsent: false })
  })
  it('cancelación fuera de plazo conserva original; dentro del plazo consume token y libera hueco', async () => {
    const result = await api.publicAgendaBook(context, input('13:30', 'cancel@test.local'), now)
    await expect(api.publicAgendaManage(context, result.token, undefined, Date.parse('2026-10-05T19:00:00Z'))).rejects.toMatchObject({ statusCode: 409 })
    const before = sendPlainEmail.mock.calls.length
    await api.publicAgendaManage(context, result.token, undefined, now)
    expect(sendPlainEmail.mock.calls.length).toBe(before + 2)
    await expect(api.publicAgendaBooking(context, result.token, now)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
    await expect(api.publicAgendaManage(context, result.token, undefined, now)).rejects.toMatchObject({ statusCode: 404 })
    const [booking] = await admin`select * from agenda_public_bookings where token_hash=${agendaHash(result.token)}`
    expect(booking!.status).toBe('canceled')
    expect((await admin`select custom_data from records where id=${booking!.record_id}`)[0]!.custom_data.estado).toBe('cancelada')
    const slots = await api.publicAgendaSlots(context, { from: '2026-10-05', to: '2026-10-05' }, now)
    expect(slots.slots.some(slot => slot.time === '13:30')).toBe(true)
  })
  it('reprogramación atómica conserva ID/historial; fallo no cambia cita/token; éxito rota token', async () => {
    const result = await api.publicAgendaBook(context, input('14:00', 'move@test.local'), now)
    const [booking] = await admin`select * from agenda_public_bookings where token_hash=${agendaHash(result.token)}`
    const replacement = { site, page, token: result.token, services: [agendaOpaqueId(site, 'service', service)], date: '2026-10-05', time: '10:00', personal: agendaOpaqueId(site, 'person', staff) }
    const jobsBefore = (await admin`select count(*)::int n from job_queue where tenant_id=${tenant}`)[0]!.n
    await expect(api.publicAgendaManage(context, result.token, replacement, now)).rejects.toMatchObject({ statusCode: 409 })
    expect((await admin`select count(*)::int n from job_queue where tenant_id=${tenant}`)[0]!.n).toBe(jobsBefore)
    expect((await api.publicAgendaBooking(context, result.token, now)).time).toBe('14:00')
    const moved = await api.publicAgendaManage(context, result.token, { ...replacement, time: '14:30' }, now)
    expect(moved.time).toBe('14:30'); expect(moved.token).not.toBe(result.token)
    const [newBooking] = await admin`select * from agenda_public_bookings where id=${booking!.id}`
    expect(newBooking!.record_id).toBe(booking!.record_id); expect(newBooking!.reschedule_count).toBe(1)
    await expect(api.publicAgendaBooking(context, result.token, now)).rejects.toMatchObject({ statusCode: 404 })
    expect((await api.publicAgendaBooking(context, moved.token!, now)).time).toBe('14:30')
    expect(await admin`select id from record_activities where record_id=${booking!.record_id} and action_type='PUBLIC_RESCHEDULE'`).toHaveLength(1)
    expect(await admin`select r.id from records r join entities e on e.id=r.entity_id where e.tenant_id=${tenant} and e.slug='agenda-servicios-cita' and r.custom_data->>'cita'=${booking!.record_id} and r.deleted_at is null`).toHaveLength(1)
  })
  it('token inválido, vencido y ajeno devuelven el mismo 404 genérico', async () => {
    const result = await api.publicAgendaBook(context, input('15:00'), now)
    const alien = await api.resolveAgendaContext(otherSite, otherPage, origin)
    for (const fn of [() => api.publicAgendaBooking(context, 'x'.repeat(43), now), () => api.publicAgendaBooking(context, result.token, Date.parse('2026-10-06T00:00:00Z')), () => api.publicAgendaBooking(alien, result.token, now)]) await expect(fn()).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
  })
  it('RLS aísla tablas y deniega escritura de otra organización y referencias ajenas', async () => {
    await app.begin(async tx => {
      await tx`select set_config('app.tenant_id',${other},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true),set_config('app.record_system','on',true)`
      expect(await tx`select * from agenda_site_settings where site_id=${site}`).toHaveLength(0)
      expect(await tx`select * from agenda_public_bookings`).toHaveLength(0)
    })
    await expect(app.begin(async tx => { await tx`select set_config('app.tenant_id',${other},true)`; await tx`insert into agenda_site_settings(site_id,tenant_id) values (${site},${other})` })).rejects.toMatchObject({ code: '42501' })
    const [booking] = await admin`select * from agenda_public_bookings where tenant_id=${tenant} limit 1`
    await expect(app.begin(async tx => {
      await tx`select set_config('app.tenant_id',${other},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true),set_config('app.record_system','on',true)`
      await tx`insert into agenda_public_bookings(tenant_id,site_id,page_id,record_id,token_hash,service_ids,expires_at,origin_hash,user_agent) values (${other},${otherSite},${otherPage},${booking!.record_id},${'a'.repeat(64)},'[]',now()+interval '1 day','hash','test')`
    })).rejects.toMatchObject({ code: '42501' })
    await expect(app.begin(async tx => { await tx`select set_config('app.tenant_id',${other},true)`; await tx`update agenda_public_bookings set status='canceled' where id=${booking!.id}`; expect(await tx`select * from agenda_public_bookings where id=${booking!.id}`).toHaveLength(0) })).resolves.toBeUndefined()
  })
  it('reutiliza por teléfono normalizado, no reutiliza contactos contradictorios y conserva datos', async () => {
    const [client] = await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},${clientEntity},'{"nombre":"Original teléfono","telefono":"+52 (477) 765-4321","correo":"original@test.local"}') returning id`
    const body = { ...input('15:30'), client: { name: 'No sobrescribir', email: '', phone: '524777654321' } }
    await setConfig({ requiredFields: ['name', 'phone'] })
    const result = await api.publicAgendaBook(context, body, now)
    const [row] = await admin`select r.custom_data from agenda_public_bookings b join records r on r.id=b.record_id where b.token_hash=${agendaHash(result.token)}`
    expect(row!.custom_data.cliente).toBe(client!.id)
    expect((await admin`select custom_data from records where id=${client!.id}`)[0]!.custom_data.nombre).toBe('Original teléfono')
    const different = await api.publicAgendaBook(context, { ...body, time: '16:00', client: { ...body.client, email: 'diferente@test.local' } }, now)
    const [second] = await admin`select r.custom_data from agenda_public_bookings b join records r on r.id=b.record_id where b.token_hash=${agendaHash(different.token)}`
    expect(second!.custom_data.cliente).not.toBe(client!.id)
    await setConfig({ requiredFields: ['phone'] })
    const optionalName = await api.publicAgendaBook(context, { ...body, date: '2026-10-06', time: '09:00', client: { ...body.client, name: '' } }, now)
    const [third] = await admin`select c.custom_data from agenda_public_bookings b join records r on r.id=b.record_id join records c on c.id=(r.custom_data->>'cliente')::uuid where b.token_hash=${agendaHash(optionalName.token)}`
    expect(third!.custom_data.nombre).toBe('Visitante del sitio')
    await setConfig({ requiredFields: ['name', 'email'] })
  })
  it('SMTP simulado fallido mantiene correos en cola sin revertir ni duplicar reserva', async () => {
    sendPlainEmail.mockImplementation(async payload => { if (payload.to === 'retry@test.local') throw new Error('SMTP local simulado') })
    const result = await api.publicAgendaBook(context, input('16:30', 'retry@test.local'), now)
    sendPlainEmail.mockResolvedValue(undefined)
    expect((await api.publicAgendaBooking(context, result.token, now)).time).toBe('16:30')
    const jobs = await admin`select status,attempts from job_queue where tenant_id=${tenant} and payload->>'to'='retry@test.local'`
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ status: 'pending', attempts: 1 })
  })
  it('partidas conservan el precio decimal de Currency sin redondearlo con Number', async () => {
    const price = '9007199254740993.12'
    const [decimal] = await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-servicios'),${admin.json({ nombre: 'Servicio decimal', duracion_minutos: 30, precio: price })}) returning id`
    await setConfig({ serviceIds: [] })
    const result = await api.publicAgendaBook(context, { ...input('09:00'), date: '2026-10-07', services: [agendaOpaqueId(site, 'service', decimal!.id)] }, now)
    const [booking] = await admin`select record_id from agenda_public_bookings where token_hash=${agendaHash(result.token)}`
    const [line] = await admin`select r.custom_data from records r join entities e on e.id=r.entity_id where e.tenant_id=${tenant} and e.slug='agenda-servicios-cita' and r.custom_data->>'cita'=${booking!.record_id} and r.deleted_at is null`
    expect(line!.custom_data.importe).toBe(price)
    await setConfig({ serviceIds: [service] })
  })
  it('endpoints reales sin red: esquema, tamaño, token en header, origen y límites HTTP sin trazas', async () => {
    const slotsHandler = (await import('../../server/api/public/agenda/slots.get')).default
    const bookHandler = (await import('../../server/api/public/agenda/book.post')).default
    const bookingHandler = (await import('../../server/api/public/agenda/booking.get')).default
    const { agendaHttp } = await import('../../server/utils/agendaPublicHttp')
    const makeEvent = (url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
      const req = new IncomingMessage(new Socket())
      req.url = url; req.method = method; req.headers = { host: 'localhost:3000', origin: origin.origin, 'content-type': 'application/json', ...headers }
      if (body !== undefined) req.push(typeof body === 'string' ? body : JSON.stringify(body))
      req.push(null)
      return createEvent(req, new ServerResponse(req))
    }
    resetPublicRateLimits()
    const query = `?site=${site}&page=${page}&from=2026-10-05&to=2026-10-05`
    // Horarios se consultan con el reloj real, dentro de su ventana vigente.
    const today = new Date().toISOString().slice(0, 10)
    const event = makeEvent(`/api/public/agenda/slots?site=${site}&page=${page}&from=${today}&to=${today}`)
    await expect(agendaHttp(event, 'book', async () => { throw { cause: { code: '23P01' }, query: 'SQL privado' } })).rejects.toMatchObject({ statusCode: 409, stack: '' })
    const slots = await slotsHandler(event)
    expect(slots).toHaveProperty('formToken'); expect(event.node.res.getHeader('cache-control')).toBe('no-store')
    await expect(slotsHandler(makeEvent('/api/public/agenda/slots' + query + '&extra=1'))).rejects.toMatchObject({ statusCode: 422, stack: '' })
    await expect(slotsHandler(makeEvent('/api/public/agenda/slots' + query, 'GET', undefined, { origin: 'https://evil.test' }))).rejects.toMatchObject({ statusCode: 404, stack: '' })
    await expect(bookHandler(makeEvent('/api/public/agenda/book', 'POST', { ...input('17:00'), tenantId: other }))).rejects.toMatchObject({ statusCode: 422, stack: '' })
    await expect(bookHandler(makeEvent('/api/public/agenda/book', 'POST', 'x'.repeat(17000)))).rejects.toMatchObject({ statusCode: 413, stack: '' })
    await expect(bookingHandler(makeEvent(`/api/public/agenda/booking?site=${site}&page=${page}`, 'GET', undefined, { 'x-flow-agenda-token': 'invalid' }))).rejects.toMatchObject({ statusCode: 404, stack: '' })
    await expect(bookingHandler(makeEvent(`/api/public/agenda/booking?site=${site}&page=${page}&token=secret`))).rejects.toMatchObject({ statusCode: 422, stack: '' })
    resetPublicRateLimits()
    await admin`delete from agenda_security_buckets where tenant_id=${tenant}`
    for (let index = 0; index < 60; index++) await slotsHandler(makeEvent(`/api/public/agenda/slots?site=${site}&page=${page}&from=${today}&to=${today}`))
    const limited = makeEvent('/api/public/agenda/slots' + query)
    await expect(slotsHandler(limited)).rejects.toMatchObject({ statusCode: 429, stack: '' })
    expect(Number(limited.node.res.getHeader('retry-after'))).toBeGreaterThan(0)
    resetPublicRateLimits()
  })
  it('cliente vinculado HU-174 con campos propios: crea/reutiliza sin pisar datos y valida el mapeo', async () => {
    const [linked] = await admin`insert into entities(tenant_id,name,slug) values (${tenant},'Clientes vinculados','clientes-vinculados') returning id`
    for (const name of ['nombre_completo', 'movil', 'email_contacto']) await admin`insert into entity_fields(entity_id,name,label,data_type,is_required) values (${linked!.id},${name},${name},'text',${name === 'nombre_completo'})`
    const { changeAgendaClient } = await import('../../server/utils/agendaClient')
    await actor(() => changeAgendaClient(tenant, linked!.id, adminId, true))
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, cancellationHours: 1, clientFields: { name: 'nombre_completo', phone: 'movil', email: 'email_contacto' } }))
    const first = await api.publicAgendaBook(context, input('17:00', 'vinculado@test.local'), now)
    await api.publicAgendaBook(context, { ...input('17:30', 'vinculado@test.local'), client: { name: 'No pisar nombre', email: 'vinculado@test.local', phone: '' } }, now)
    const clients = await admin`select id,custom_data from records where entity_id=${linked!.id}`
    expect(clients).toHaveLength(1); expect(clients[0]!.custom_data).toMatchObject({ nombre_completo: 'Ana pública', email_contacto: 'vinculado@test.local' })
    const [cita] = await admin`select r.custom_data from agenda_public_bookings b join records r on r.id=b.record_id where b.token_hash=${agendaHash(first.token)}`
    expect(cita!.custom_data.cliente).toBe(clients[0]!.id)
    await expect(actor(() => api.agendaSiteAdministration(auth, site, { enabled: true }))).rejects.toMatchObject({ statusCode: 404 })
  })
  it('administrador atiende reservas públicas con acento personalizado sin exponer su identidad interna', async () => {
    await setConfig({ personalIds: [adminId], accent: 'custom', accentColor: '#AbC' })
    const presentation = await api.publicAgendaPresentation(context, 'es')
    expect(presentation.runtime.accent).toBe('#aabbcc')
    expect(presentation.people).toEqual([{ id: agendaOpaqueId(site, 'person', adminId), name: 'Administrador privado' }])
    const booked = await api.publicAgendaBook(context, { ...input('15:00'), personal: agendaOpaqueId(site, 'person', adminId), date: '2026-10-09' }, now)
    expect(booked.personal).toBe('Administrador privado')
    const [record] = await admin`select r.custom_data from agenda_public_bookings b join records r on r.id=b.record_id where b.token_hash=${agendaHash(booked.token)}`
    expect(record!.custom_data.personal).toBe(adminId)
    await setConfig({ personalIds: [staff], accent: 'primary' })
  })
  it('eliminar página o sitio mantiene las citas y elimina únicamente sus vínculos públicos', async () => {
    await api.publicAgendaBook(context, { ...input('09:00'), date: '2026-10-09' }, now)
    const count = (await admin`select count(*)::int n from records where entity_id=${base}`)[0]!.n
    expect((await admin`select count(*)::int n from agenda_public_bookings where site_id=${site}`)[0]!.n).toBeGreaterThan(0)
    await admin`delete from site_pages where id=${page}`
    expect(await admin`select id from agenda_public_bookings where site_id=${site}`).toHaveLength(0)
    expect((await admin`select count(*)::int n from records where entity_id=${base}`)[0]!.n).toBe(count)
    const policies = await admin`select confdeltype from pg_constraint where conrelid='agenda_public_bookings'::regclass and contype='f' and confrelid in ('sites'::regclass,'site_pages'::regclass,'records'::regclass)`
    expect(policies).toHaveLength(3); expect(policies.every(policy => policy.confdeltype === 'c')).toBe(true)
    await admin`delete from sites where id=${site}`
    expect(await admin`select site_id from agenda_site_settings where site_id=${site}`).toHaveLength(0)
    expect((await admin`select count(*)::int n from records where entity_id=${base}`)[0]!.n).toBe(count)
  })
})
