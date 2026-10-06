import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { ClaimedJob } from '../../server/utils/jobQueue'

const mocks = vi.hoisted(() => ({ smtp: vi.fn(), stripe: { current: null as any } }))
vi.mock('../../server/utils/mailer', () => ({ sendPlainEmail: mocks.smtp }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => { throw new Error('No se permite SMTP real en estas pruebas') } } }))
vi.mock('stripe', () => ({ default: class { subscriptions = { retrieve: async () => mocks.stripe.current }; webhooks = { constructEvent: () => ({}) } } }))
let fixture: TestDb, owner: postgres.Sql, connection: typeof import('../../server/db')
let lifecycle: typeof import('../../server/utils/accountLifecycle'), notices: typeof import('../../server/utils/accountNotices')
let deletion: typeof import('../../server/utils/accountDeletion'), exports: typeof import('../../server/utils/accountExport')
let platform: typeof import('../../server/utils/accountPlatform'), jobs: typeof import('../../server/utils/jobQueue')
let billing: typeof import('../../server/utils/billing')
const objects = new Map<string, Buffer>(), removed: Array<{ kind: string; ref: string }> = []
const now = new Date('2026-10-05T00:00:00.000Z')
beforeAll(async () => {
  vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input))
  fixture = await createTestDb(); owner = postgres(fixture.ownerUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = fixture.appUrl; process.env.PLAN_CACHE_TTL_MS = '0'; process.env.JWT_SECRET = 'synthetic-account191-signing-key'
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
  connection = await import('../../server/db')
  lifecycle = await import('../../server/utils/accountLifecycle'); notices = await import('../../server/utils/accountNotices')
  deletion = await import('../../server/utils/accountDeletion'); exports = await import('../../server/utils/accountExport')
  platform = await import('../../server/utils/accountPlatform'); jobs = await import('../../server/utils/jobQueue'); billing = await import('../../server/utils/billing')
  ;(await import('../../server/utils/objectStorage')).setStoredObjectAdapter({
    put: async input => { objects.set(input.key, input.body) }, get: async key => { const body = objects.get(key); if (!body) throw new Error('No encontrado'); return body },
    delete: async key => { objects.delete(key) }, list: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix))
  })
  deletion.setAccountRemovalAdapter(async item => { removed.push(item); if (item.kind === 'file') objects.delete(item.ref) })
  mocks.smtp.mockResolvedValue(undefined)
  await owner`update plans set stripe_monthly_price_id='price191_'||key`
}, 120000)
afterAll(async () => {
  deletion?.setAccountRemovalAdapter(null)
  if (connection) { (await import('../../server/utils/objectStorage')).setStoredObjectAdapter(null); await connection.client.end() }
  await owner?.end(); await fixture?.stop()
  for (const key of ['APP_DATABASE_URL','PLAN_CACHE_TTL_MS','JWT_SECRET','ACCOUNT_DELETION_ENABLED','PLATFORM_CRM_TENANT_SLUG']) delete process.env[key]
  vi.useRealTimers(); vi.unstubAllGlobals()
})
async function account(options: { status?: string; provider?: string; plan?: string; end?: string; owner?: boolean } = {}) {
  const tenant = randomUUID(), person = randomUUID(), role = randomUUID(), user = randomUUID(), entity = randomUUID()
  await owner`insert into tenants(id,name,slug,onboarding_status) values (${tenant},'Empresa sintética 191',${'test191-' + tenant},'complete')`
  await owner`insert into roles(id,tenant_id,name,is_system) values (${role},${tenant},'Administrador',true)`
  await owner`insert into people(id,email,password_hash,full_name,email_verified_at) values (${person},${person + '@local.test'},'SECRETO-NO-EXPORTAR','Persona sintética',now())`
  if (options.owner !== false) await owner`insert into users(id,tenant_id,person_id,role_id) values (${user},${tenant},${person},${role})`
  await owner`insert into tenant_subscriptions(tenant_id,plan_id,provider,status,current_period_end,trial_ends_at,stripe_subscription_id,stripe_customer_id)
    select ${tenant},id,${options.provider ?? 'stripe'},${options.status ?? 'canceled'},${options.end ?? '2026-04-01T00:00:00Z'}::timestamptz,${options.end ?? '2026-04-01T00:00:00Z'}::timestamptz,${'sub191_' + tenant},${'cus191_' + tenant} from plans where key=${options.plan ?? 'starter'}`
  await owner`insert into entities(id,tenant_id,name,slug) values (${entity},${tenant},'Módulo sintético','modulo191')`
  await owner`insert into records(tenant_id,entity_id,custom_data,created_at,updated_at) values (${tenant},${entity},${owner.json({ nombre: 'DATO-' + tenant })},${now},${now})`
  return { tenant, person, role, user, entity }
}
const claimed = (tenantId: string, kind: string, payload: Record<string, unknown>): ClaimedJob => ({ id: randomUUID(), tenantId, kind, payload, attempts: 1, maxAttempts: 100000 })

describe('191: máquina única y recuperación', () => {
  it('UTC: gracia exacta, suspensión, 30 días antes y fecha de borrado', async () => {
    const a = await account({ status: 'past_due' })
    await owner`update tenants set account_lifecycle=account_lifecycle||'{"paymentDueAt":"2026-01-01T00:00:00Z"}'::jsonb where id=${a.tenant}`
    expect((await lifecycle.accountLifecycle(a.tenant, new Date('2026-01-07T23:59:59Z'))).phase).toBe('payment_due')
    const suspended = await lifecycle.accountLifecycle(a.tenant, new Date('2026-01-08T00:00:00Z'))
    expect(suspended.phase).toBe('suspended'); expect(new Date(suspended.deleteAt!).toISOString()).toBe('2026-07-07T00:00:00.000Z')
    expect((await lifecycle.accountLifecycle(a.tenant, new Date('2026-06-07T00:00:00Z'))).phase).toBe('pending_deletion')
    for (const date of ['2026-01-08','2026-06-07','2026-07-07']) {
      await owner`update tenant_subscriptions set status='past_due' where tenant_id=${a.tenant}`
      await owner`update tenants set account_lifecycle=account_lifecycle||'{"paymentDueAt":"2026-01-01T00:00:00Z"}'::jsonb where id=${a.tenant}`
      await notices.reconcileAccount(a.tenant, new Date(date))
      await owner`update tenant_subscriptions set status='active' where tenant_id=${a.tenant}`
      expect((await notices.reconcileAccount(a.tenant, new Date(date))).phase).toBe('active')
    }
    const events = await owner`select phase from account_lifecycle_events where tenant_hash=encode(digest(${a.tenant},'sha256'),'hex')`
    expect(events.some(row => row.phase === 'active')).toBe(true)
  })
  it('cancelación respeta periodo pagado; trial vencida sin tarjeta bloquea', async () => {
    const paid = await account({ end: '2027-01-01T00:00:00Z' }), trial = await account({ status: 'trialing' })
    expect((await lifecycle.accountLifecycle(paid.tenant, now)).phase).toBe('active')
    expect(await lifecycle.accountLifecycle(trial.tenant, now)).toMatchObject({ phase: 'pending_deletion', reason: 'trial_ended' })
  })
  it('manual, empresarial, plataforma y exención no se suspenden ni borran', async () => {
    const manual = await account({ provider: 'manual' }), enterprise = await account({ plan: 'empresarial' }), explicit = await account(), system = await account()
    await owner`update tenants set account_lifecycle='{"exempt":true}'::jsonb where id=${explicit.tenant}`
    process.env.PLATFORM_CRM_TENANT_SLUG = 'test191-' + system.tenant
    for (const a of [manual, enterprise, explicit, system]) expect(await lifecycle.accountLifecycle(a.tenant, now)).toMatchObject({ phase: 'active', exempt: true })
    process.env.ACCOUNT_DELETION_ENABLED = 'true'
    for (const a of [manual, enterprise, explicit, system]) expect(await deletion.deleteAccount(a.tenant, { now })).toMatchObject({ status: 'postponed', reason: 'active_or_exempt' })
    delete process.env.PLATFORM_CRM_TENANT_SLUG; delete process.env.ACCOUNT_DELETION_ENABLED
  })
  it('política global, excepción por organización y rechazo de entradas inválidas', async () => {
    const a = await account()
    await platform.changeAccountPolicy({ graceDays: 2, retentionDays: 365, warningDays: [30,7,1] })
    expect((await lifecycle.accountLifecycle(a.tenant, now)).phase).toBe('suspended')
    await platform.changeAccountLifecycle({ tenantId: a.tenant, action: 'policy', reason: 'Excepción de pruebas', policy: { graceDays: 4, retentionDays: 180, warningDays: [30,7,1] } }, now)
    expect((await lifecycle.accountLifecycle(a.tenant, now)).phase).toBe('pending_deletion')
    await expect(platform.changeAccountPolicy({ graceDays: -1, retentionDays: 10, warningDays: [30] })).rejects.toThrow()
    await platform.changeAccountPolicy({ graceDays: 7, retentionDays: 180, warningDays: [30,7,1] })
    await platform.changeAccountLifecycle({ tenantId: a.tenant, action: 'cancel_deletion', reason: 'Conservación autorizada' }, now)
    expect(await lifecycle.accountLifecycle(a.tenant, now)).toMatchObject({ phase: 'active', exempt: true })
  })
  it('withTenant bloquea datos sin depender del cliente; recovery conserva RLS', async () => {
    const a = await account(), b = await account()
    await expect(connection.withTenant(a.tenant, tx => tx.execute(sql`select * from records`))).rejects.toMatchObject({ statusCode: 403 })
    const rows = await connection.withTenantRecovery(a.tenant, tx => tx.execute(sql`select tenant_id from entities`))
    expect(rows.length).toBeGreaterThan(0); expect(rows.every(row => row.tenant_id === a.tenant)).toBe(true)
    expect(rows.some(row => row.tenant_id === b.tenant)).toBe(false)
  })
})
describe('191: avisos y trabajo suspendido', () => {
  it('SMTP ordinario, disparadores y cron de uso se bloquean antes de producir efectos', async () => {
    const a = await account()
    const mailer = await vi.importActual<typeof import('../../server/utils/mailer')>('../../server/utils/mailer')
    await expect(mailer.sendPlainEmail({ tenantId: a.tenant, to: 'local@local.test', subject: 'Sintético', text: 'Prueba', html: '<p>Prueba</p>' })).rejects.toMatchObject({ statusCode: 403 })
    const triggers = await import('../../server/utils/triggers')
    await expect(triggers.evaluateTriggersForRecord(a.tenant, a.entity, 'on_create', {})).rejects.toMatchObject({ statusCode: 403 })
    await expect(billing.captureTenantUsage(a.tenant)).rejects.toMatchObject({ statusCode: 403 })
    expect(await owner`select id from trigger_logs where tenant_id=${a.tenant}`).toHaveLength(0)
    expect(await owner`select id from tenant_usage_snapshots where tenant_id=${a.tenant}`).toHaveLength(0)
  })
  it('público 503 noindex antes de SEO/activos; agenda y formularios fallan genéricamente; pago restaura dominio', async () => {
    const a = await account(), site = randomUUID(), page = randomUUID(), version = randomUUID(), host = 'cuenta191-' + randomUUID() + '.test'
    await owner`insert into sites(id,tenant_id,name,slug,status) values (${site},${a.tenant},'Sitio de prueba','prueba191','published')`
    await owner`insert into site_pages(id,tenant_id,site_id,path,title,status) values (${page},${a.tenant},${site},'/','Inicio','published')`
    await owner`insert into site_page_versions(id,tenant_id,site_id,page_id,version,status,html,form_manifest) values (${version},${a.tenant},${site},${page},1,'published','<h1>Restaurado</h1>',${owner.json([{ id: 'contacto', fields: [] }])})`
    await owner`update site_pages set published_version_id=${version} where id=${page}`
    await owner`insert into site_domains(tenant_id,site_id,hostname,status,is_primary) values (${a.tenant},${site},${host},'active',true)`
    await owner`insert into agenda_site_settings(tenant_id,site_id,config) values (${a.tenant},${site},'{"enabled":true}')`
    await owner`insert into site_form_connections(tenant_id,site_id,page_id,form_key,entity_id) values (${a.tenant},${site},${page},'contacto',${a.entity})`
    const handler = (await import('../../server/middleware/site-domain')).default
    const request = (route: string) => { const req = new IncomingMessage(new Socket()); req.url = route; req.headers.host = host; return createEvent(req, new ServerResponse(req)) }
    for (const route of ['/', '/sitemap.xml', '/robots.txt', '/assets/logo.png']) {
      const event = request(route)
      expect(await handler(event)).toContain('Sitio no disponible'); expect(event.node.res.statusCode).toBe(503)
      expect(event.node.res.getHeader('x-robots-tag')).toBe('noindex, nofollow'); expect(event.node.res.getHeader('cache-control')).toBe('no-store')
    }
    const agenda = await import('../../server/utils/agendaPublic')
    await expect(agenda.resolveAgendaContext(site, page, { origin: `https://${host}`, host, ip: '127.0.0.1', userAgent: 'Prueba' })).rejects.toMatchObject({ statusCode: 404 })
    const forms = await import('../../server/utils/siteFormSubmissions')
    await expect(forms.submitSiteForm({ siteId: site, pageId: page, formKey: 'contacto', payload: {}, origin: { domain: host, path: '/', referrer: null, userAgent: null, utm: {}, capturedAt: now.toISOString() } })).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Formulario no disponible.' })
    await owner`update tenant_subscriptions set status='active' where tenant_id=${a.tenant}`
    expect(await handler(request('/'))).toContain('Restaurado')
    expect(await agenda.resolveAgendaContext(site, page, { origin: `https://${host}`, host, ip: '127.0.0.1', userAgent: 'Prueba' })).toMatchObject({ tenantId: a.tenant })
  })
  it('avisos únicos por ciclo/destinatario; SMTP caído reintenta y nunca permite borrar', async () => {
    const a = await account()
    await notices.reconcileAccount(a.tenant, now); await notices.reconcileAccount(a.tenant, now)
    const rows = await owner`select id,kind from account_notices where tenant_id=${a.tenant}`
    expect(rows.map(row => row.kind).sort()).toEqual(['deletion_1','deletion_30','deletion_7','suspended'])
    expect(await owner`select id from job_queue where tenant_id=${a.tenant} and kind='account_notice'`).toHaveLength(4)
    mocks.smtp.mockRejectedValueOnce(new Error('SMTP sintético caído'))
    expect(await notices.handleAccountNotice(claimed(a.tenant, 'account_notice', { noticeId: rows[0]!.id }))).toMatchObject({ ok: false, retryable: true })
    expect((await lifecycle.accountLifecycle(a.tenant, now)).phase).toBe('pending_deletion')
    process.env.ACCOUNT_DELETION_ENABLED = 'true'
    expect(await deletion.deleteAccount(a.tenant, { now })).toMatchObject({ status: 'postponed', reason: 'mandatory_notice_pending' })
    expect(await owner`select id from tenants where id=${a.tenant}`).toHaveLength(1)
    await notices.handleAccountNotice(claimed(a.tenant, 'account_notice', { noticeId: rows[0]!.id }))
    const calls = mocks.smtp.mock.calls.length
    await notices.handleAccountNotice(claimed(a.tenant, 'account_notice', { noticeId: rows[0]!.id }))
    expect(mocks.smtp.mock.calls.length).toBe(calls)
    delete process.env.ACCOUNT_DELETION_ENABLED
  })
  it('cola no toma trabajos ordinarios ni consume intentos; reactivación los libera', async () => {
    const a = await account()
    const ordinary = randomUUID(), recovery = randomUUID()
    await owner`insert into job_queue(id,tenant_id,kind,payload,run_at) values (${ordinary},${a.tenant},'email','{}',${now}),(${recovery},${a.tenant},'account_export','{}',${now})`
    const batch = await jobs.claimJobs({ batchSize: 1000, perTenantLimit: 100, now, workerId: 'test191' })
    expect(batch.some(job => job.id === ordinary)).toBe(false); expect(batch.some(job => job.id === recovery)).toBe(true)
    expect((await owner`select status,attempts from job_queue where id=${ordinary}`)[0]).toMatchObject({ status: 'pending', attempts: 0 })
    await owner`update tenant_subscriptions set status='active' where tenant_id=${a.tenant}`
    expect((await jobs.claimJobs({ batchSize: 1000, perTenantLimit: 100, now, workerId: 'test191' })).some(job => job.id === ordinary)).toBe(true)
  })
  it('OLAP conserva el trabajo suspendido en cola sin bloquear a otra organización; retoma con los registros actuales', async () => {
    const a = await account(), b = await account({ status: 'active' })
    const [record] = await owner`select id from records where tenant_id=${a.tenant}`
    const olap = await import('../../server/utils/olapEtl')
    const result = await olap.runOlapEtl(new Date('2026-10-06'), { lagMs: 0 })
    expect(result.recordsDeferred).toBeGreaterThan(0)
    expect(await owner`select id from fact_eventos where tenant_id=${a.tenant}`).toHaveLength(0)
    expect(await owner`select id from fact_eventos where tenant_id=${b.tenant}`).toHaveLength(1)
    const [job] = await owner`select payload,status,attempts from job_queue where tenant_id=${a.tenant} and kind='olap_sync'`
    expect(job).toMatchObject({ status: 'pending', attempts: 0 }); expect(job!.payload.recordIds).toContain(record!.id)
    await owner`update tenant_subscriptions set status='active' where tenant_id=${a.tenant}`
    await olap.runOlapEtl(new Date('2026-10-06'), { tenantId: a.tenant, recordIds: job!.payload.recordIds })
    expect(await owner`select id from fact_eventos where tenant_id=${a.tenant}`).toHaveLength(1)
  })
})

describe('191: exportación y eliminación aisladas', () => {
  it('JSON por tabla, registros, índice, adjuntos; firma, caducidad y aislamiento', async () => {
    const a = await account(), b = await account()
    await owner`insert into entity_fields(entity_id,name,label,data_type) values (${a.entity},'campo_exportado','Campo propio exportado','text'),(${b.entity},'campo_ajeno','CAMPO-AJENO-NO-EXPORTAR','text')`
    await owner`update tenants set fiscal_data='{"rfc":"RFC-SINTETICO"}'::jsonb where id=${a.tenant}`
    const key = `tenants/${a.tenant}/files/documento.pdf`; objects.set(key, Buffer.from('ADJUNTO-SINTETICO'))
    await owner`insert into files(tenant_id,entity_id,file_name,mime_type,size_bytes,storage_key) values (${a.tenant},${a.entity},'documento.pdf','application/pdf',17,${key})`
    await owner`insert into tenant_email_settings(tenant_id,password_encrypted,from_email) values (${a.tenant},'CIFRADO-NO-EXPORTAR','local@local.test')`
    const serie = randomUUID(), document = randomUUID(), xml = `tenants/${a.tenant}/cfdi/${document}.xml`, pdf = `tenants/${a.tenant}/cfdi/${document}.pdf`
    objects.set(xml, Buffer.from('<cfdi>SINTETICO-XML</cfdi>')); objects.set(pdf, Buffer.from('SINTETICO-PDF'))
    await owner`insert into cfdi_series(id,tenant_id,serie,tipo_comprobante,lugar_expedicion) values (${serie},${a.tenant},'A','I','01000')`
    await owner`insert into cfdi_documents(id,tenant_id,serie_id,tipo,xml_storage_key,pdf_storage_key) values (${document},${a.tenant},${serie},'I',${xml},${pdf})`
    const request = await exports.requestAccountExport(a.tenant, now)
    expect(await exports.requestAccountExport(a.tenant, now)).toEqual(request)
    expect(await exports.handleAccountExport(claimed(a.tenant, 'account_export', { exportId: request.id }))).toEqual({ ok: true })
    const list = await exports.accountExports(a.tenant), url = new URL(list.exports[0]!.url!, 'http://localhost')
    const bytes = await exports.downloadAccountExport(a.tenant, request.id, url.searchParams.get('expires')!, url.searchParams.get('signature')!, now)
    const tar = gunzipSync(bytes).toString()
    expect(tar).toContain('indice.json'); expect(tar).toContain(`modulos/${a.entity}-1.json`); expect(tar).toContain('DATO-' + a.tenant); expect(tar).toContain('ADJUNTO-SINTETICO')
    expect(tar).not.toContain('DATO-' + b.tenant); expect(tar).not.toContain('SECRETO-NO-EXPORTAR'); expect(tar).not.toContain('CIFRADO-NO-EXPORTAR')
    expect(tar).toContain('SINTETICO-XML'); expect(tar).toContain('SINTETICO-PDF')
    expect(tar).toContain('campo_exportado'); expect(tar).toContain('RFC-SINTETICO'); expect(tar).not.toContain('CAMPO-AJENO-NO-EXPORTAR')
    await expect(exports.downloadAccountExport(b.tenant, request.id, url.searchParams.get('expires')!, url.searchParams.get('signature')!, now)).rejects.toMatchObject({ statusCode: 403 })
    await expect(exports.downloadAccountExport(a.tenant, request.id, url.searchParams.get('expires')!, url.searchParams.get('signature')!, new Date('2026-10-07'))).rejects.toMatchObject({ statusCode: 410 })
    const stored = `tenants/${a.tenant}/account-exports/${request.id}.tar.gz`
    expect(objects.has(stored)).toBe(true)
    await exports.cleanupExpiredAccountExports(a.tenant, new Date('2026-10-07'))
    expect(objects.has(stored)).toBe(false)
  })
  it('entrega registros e índice aunque un adjunto exceda el límite o falte', async () => {
    const a = await account(), oversized = `tenants/${a.tenant}/files/grande.pdf`, missing = `tenants/${a.tenant}/files/faltante.pdf`
    objects.set(oversized, Buffer.alloc(exports.ACCOUNT_EXPORT_LIMIT))
    await owner`insert into files(tenant_id,entity_id,file_name,mime_type,size_bytes,storage_key) values (${a.tenant},${a.entity},'grande.pdf','application/pdf',${exports.ACCOUNT_EXPORT_LIMIT},${oversized}),(${a.tenant},${a.entity},'faltante.pdf','application/pdf',10,${missing})`
    const request = await exports.requestAccountExport(a.tenant, now)
    expect(await exports.handleAccountExport(claimed(a.tenant, 'account_export', { exportId: request.id }))).toEqual({ ok: true })
    const tar = gunzipSync(objects.get(`tenants/${a.tenant}/account-exports/${request.id}.tar.gz`)!).toString()
    expect(tar).toContain('DATO-' + a.tenant); expect(tar).toContain('indice.json')
    expect(tar).toContain('"attachmentsComplete": false'); expect(tar).toContain('Adjunto omitido por el límite'); expect(tar).toContain('Archivo no disponible')
    objects.delete(oversized)
  })
  it('simulación sin escrituras, flag apagada, avisos tardíos y cuenta sin administrador', async () => {
    const a = await account(), missing = await account({ owner: false })
    const before = await owner`select account_lifecycle from tenants order by id`
    expect(await platform.simulateAccountLifecycle(now)).toMatchObject({ simulation: true })
    expect(await owner`select account_lifecycle from tenants order by id`).toEqual(before)
    expect(await deletion.deleteAccount(a.tenant, { now })).toEqual({ status: 'disabled' })
    expect(await deletion.accountDeletionEligibility(missing.tenant, now)).toMatchObject({ eligible: false, reason: 'no_administrator' })
    await notices.reconcileAccount(a.tenant, now)
    for (const row of await owner`select id from account_notices where tenant_id=${a.tenant}`) await notices.handleAccountNotice(claimed(a.tenant, 'account_notice', { noticeId: row.id }))
    expect(await deletion.accountDeletionEligibility(a.tenant, now)).toMatchObject({ eligible: false, reason: 'notice_period_pending' })
  })
  it('esquema completo: tenant_id con cascada; única excepción histórica documentada', async () => {
    const rows = await owner`select c.relname,coalesce(f.confdeltype::text,'sin_fk') as deletion from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped
      left join pg_constraint f on f.conrelid=c.oid and f.contype='f' and f.confrelid='tenants'::regclass and a.attnum=any(f.conkey)
      where n.nspname='public' and c.relkind='r' order by c.relname`
    expect(rows.filter(row => row.relname !== 'platform_crm_events' && row.deletion !== 'c')).toEqual([])
    expect(rows.some(row => row.relname === 'account_notices')).toBe(true)
    const functions = await owner`select proname,proconfig from pg_proc where proname in ('account_lifecycle_state','account_delete_finish','account_delete_batch')`
    expect(functions.every(row => !(row.proconfig as string[]).some(value => value.startsWith('app.') || value.startsWith('flow.')))).toBe(true)
    const tables = rows.map(row => `| ${row.relname} | ${row.deletion === 'c' ? 'CASCADE' : 'Excepción histórica CRM'} |`).join('\n')
    fs.writeFileSync(path.resolve('C:/desarrollo/ERP-Dinamico/DOCS/tareas/erd191-tablas.md'), '# Catálogo real de la base temporal migrada como erp_owner\n\n| Tabla | tenant_id → tenants |\n|---|---|\n' + tables + '\n')
  })
  it('borrado reanudable, providers simulados, archivos huérfanos, sesiones e identidades compartidas', async () => {
    const a = await account(), b = await account({ status: 'active' })
    const destination = await account({ provider: 'manual', status: 'active' })
    process.env.PLATFORM_CRM_TENANT_SLUG = 'test191-' + destination.tenant
    const crm = await import('../../server/utils/platformCrm')
    await crm.installPlatformCrm(true)
    await crm.syncPlatformClient(a.tenant)
    const [client] = await owner`select r.id from records r join entities e on e.id=r.entity_id where r.tenant_id=${destination.tenant} and e.slug='clientes' and r.custom_data->>'organizacion_id'=${a.tenant}`
    await owner`update records set custom_data=custom_data||'{"contacto":"PERSONAL-CRM-NO-CONSERVAR","notas":"PRIVADO-CRM"}'::jsonb where id=${client!.id}`
    const stalePayload = { tenantId: a.tenant, deleted: { nombre: 'Empresa sintética 191', correo: 'CORREO-ANTIGUO@local.test', fecha_alta: now.toISOString(), fecha_baja: now.toISOString() } }
    await owner`insert into job_queue(tenant_id,kind,payload) values (${destination.tenant},'platform_crm',${owner.json(stalePayload)})`
    await owner`insert into users(tenant_id,person_id,role_id) values (${b.tenant},${a.person},${b.role})`
    await owner`insert into auth_sessions(tenant_id,user_id,expires_at) values (${a.tenant},${a.user},now()+interval '1 day')`
    const own = `tenants/${a.tenant}/archivos/huerfano.bin`, other = `tenants/${b.tenant}/archivos/conservar.bin`
    objects.set(own, Buffer.from('PROPIO')); objects.set(other, Buffer.from('AJENO'))
    const site = randomUUID(), domain = 'borrado191-' + randomUUID() + '.test'
    await owner`insert into sites(id,tenant_id,name,slug) values (${site},${a.tenant},'Sitio','borrado191')`
    await owner`insert into site_domains(tenant_id,site_id,hostname,provider,provider_data,status) values (${a.tenant},${site},${domain},'cloudflare','{"cloudflare":{"id":"simulado"}}','active')`
    const serie = randomUUID(), document = randomUUID()
    await owner`insert into cfdi_series(id,tenant_id,serie,tipo_comprobante,lugar_expedicion) values (${serie},${a.tenant},'A','I','01000')`
    await owner`insert into cfdi_documents(id,tenant_id,serie_id,tipo) values (${document},${a.tenant},${serie},'I')`
    await owner`insert into cfdi_events(tenant_id,document_id,tipo) values (${a.tenant},${document},'folio_asignado')`
    await expect(owner`delete from cfdi_events where tenant_id=${a.tenant}`).rejects.toThrow('append-only')
    await notices.reconcileAccount(a.tenant, now)
    await owner`update account_notices set sent_at='2026-08-01' where tenant_id=${a.tenant}`
    process.env.ACCOUNT_DELETION_ENABLED = 'true'
    expect(await deletion.deleteAccount(a.tenant, { now })).toEqual({ status: 'prepared' })
    expect((await lifecycle.accountLifecycle(a.tenant, now)).reason).toBe('deletion_started')
    const paid = { id: 'sub191_' + a.tenant, metadata: { tenantId: a.tenant }, customer: 'cus191_' + a.tenant, status: 'active', trial_end: null, cancel_at_period_end: false, items: { data: [{ price: { id: 'price191_starter', recurring: { interval: 'month' } } }] } } as Parameters<typeof billing.syncStripeSubscription>[0]
    await expect(billing.syncStripeSubscription(paid, a.tenant)).rejects.toThrow('borrado ya comenzó')
    await expect(platform.changeAccountLifecycle({ tenantId: a.tenant, action: 'exempt', exempt: true, reason: 'Pago tardío' }, now)).rejects.toMatchObject({ statusCode: 409 })
    deletion.setAccountRemovalAdapter(async () => { throw new Error('Proveedor sintético no disponible') })
    expect(await deletion.deleteAccount(a.tenant, { now })).toMatchObject({ status: 'postponed', reason: 'cleanup_failed' })
    expect(await owner`select id from tenants where id=${a.tenant}`).toHaveLength(1)
    deletion.setAccountRemovalAdapter(async item => { removed.push(item); if (item.kind === 'file') objects.delete(item.ref) })
    let result: { status: string } = { status: 'continuing' }
    for (let iteration = 0; iteration < 30 && result.status !== 'deleted'; iteration++) result = await deletion.deleteAccount(a.tenant, { now })
    expect(result.status).toBe('deleted'); expect(await deletion.deleteAccount(a.tenant, { now })).toEqual({ status: 'already_deleted' })
    expect(objects.has(own)).toBe(false); expect(objects.has(other)).toBe(true)
    expect(await owner`select id from tenants where id=${a.tenant}`).toHaveLength(0)
    expect(await owner`select id from tenants where id=${b.tenant}`).toHaveLength(1)
    expect(await owner`select id from auth_sessions where tenant_id=${a.tenant}`).toHaveLength(0)
    expect(await owner`select id from people where id=${a.person}`).toHaveLength(1)
    expect(removed.some(item => item.kind === 'subscription' && item.ref === 'sub191_' + a.tenant)).toBe(true)
    expect(removed.some(item => item.kind === 'customer' && item.ref === 'cus191_' + a.tenant)).toBe(true)
    expect(removed.some(item => item.kind === 'domain' && item.ref === domain)).toBe(true)
    const catalog = await owner`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' where n.nspname='public' and c.relkind='r' and c.relname<>'platform_crm_events'`
    for (const table of catalog) expect(await owner`select 1 from ${owner(String(table.relname))} where tenant_id=${a.tenant}`).toHaveLength(0)
    const [event] = await owner`select payload from platform_crm_events where tenant_id=${a.tenant}`
    expect(event!.payload.deleted).toMatchObject({ correo: null, purged: true }); expect(JSON.stringify(event)).not.toContain('@local.test')
    const [crmJob] = await owner`select payload from job_queue where tenant_id=${destination.tenant} and kind='platform_crm' and payload->>'tenantId'=${a.tenant}`
    expect(crmJob!.payload.deleted).toMatchObject({ correo: null, purged: true }); expect(JSON.stringify(crmJob)).not.toContain('CORREO-ANTIGUO')
    // Incluso un evento que un proceso ya capturó antes de depurar la cola.
    expect(await (await import('../../server/utils/platformCrmQueue')).handlePlatformCrmJob(claimed(destination.tenant, 'platform_crm', stalePayload))).toEqual({ ok: true })
    const [tombstone] = await owner`select custom_data from records where id=${client!.id}`
    expect(tombstone!.custom_data.estado).toBe('Cancelado/Eliminado')
    expect(Object.keys(tombstone!.custom_data).sort()).toEqual(['nombre','origen','estado','plan','fecha_alta','fecha_baja','organizacion_id'].sort())
    expect(JSON.stringify(tombstone)).not.toContain('PERSONAL-CRM'); expect(JSON.stringify(tombstone)).not.toContain('@local.test')
    delete process.env.PLATFORM_CRM_TENANT_SLUG
    delete process.env.ACCOUNT_DELETION_ENABLED
  })
  it('Stripe simulado: eventos repetidos/viejos no revierten pago; pago gana antes del borrado', async () => {
    const a = await account()
    const subscription = { id: 'sub191_' + a.tenant, metadata: { tenantId: a.tenant }, customer: 'cus191_' + a.tenant, status: 'active', trial_end: null, cancel_at_period_end: false, items: { data: [{ price: { id: 'price191_starter', recurring: { interval: 'month' } } }] } } as Parameters<typeof billing.syncStripeSubscription>[0]
    await billing.syncStripeSubscription(subscription, a.tenant, { id: 'event-new', created: 200 })
    await billing.syncStripeSubscription({ ...subscription, status: 'past_due' }, a.tenant, { id: 'event-old', created: 100 })
    await billing.syncStripeSubscription({ ...subscription, status: 'past_due' }, a.tenant, { id: 'event-new', created: 200 })
    expect((await lifecycle.accountLifecycle(a.tenant, now)).phase).toBe('active')
    process.env.ACCOUNT_DELETION_ENABLED = 'true'
    expect(await deletion.deleteAccount(a.tenant, { now })).toMatchObject({ status: 'postponed', reason: 'active_or_exempt' })
    delete process.env.ACCOUNT_DELETION_ENABLED
  })
})
