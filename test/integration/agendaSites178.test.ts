import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import type { AuthTokenPayload } from '../../server/utils/auth'
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db'), api: typeof import('../../server/utils/agendaPublic'), sites: typeof import('../../server/utils/sites')
const tenant = randomUUID(), foreignTenant = randomUUID()
let user: string, role: string, staff: string, service: string, site: string, page: string, auth: AuthTokenPayload
const actor = <T>(fn: () => Promise<T>) => withRecordActor({ userId: user, roleId: role }, fn)
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} }); process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = 'http://localhost:3000'
  for (const id of [tenant, foreignTenant]) await admin`insert into tenants(id,name,slug) values (${id},'Sites Agenda',${'erd178-' + id})`
  for (const name of ['Administrador', 'Personal']) {
    const [r] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},${name},${name === 'Administrador'}) returning id`
    const [p] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x',${name === 'Personal' ? 'Ana' : 'Administrador'}) returning id`
    const [u] = await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${p!.id},${r!.id}) returning id`
    if (name === 'Administrador') { user = u!.id; role = r!.id } else staff = u!.id
  }
  auth = { sub: user, roleId: role, tenantId: tenant } as AuthTokenPayload
  connection = await import('../../server/db'); api = await import('../../server/utils/agendaPublic'); sites = await import('../../server/utils/sites')
  await (await import('../../server/utils/agendaTemplate')).installAgendaTemplate(tenant)
  const [s] = await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-servicios'),' {"nombre":"Corte","duracion_minutos":30,"precio":100}') returning id`; service = s!.id
  const created = await actor(() => sites.createSite(tenant, user, { name: 'Agenda', slug: 'agenda-' + randomUUID(), locale: 'es-MX' })); site = created!.id
  const [p] = await admin`select id from site_pages where site_id=${site}`; page = p!.id
}, 90000)
afterAll(async () => { await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; delete process.env.APP_BASE_URL })
describe('Sites agenda 178, persistencia real y render sin solicitudes de reserva', () => {
  it('la administración entrega catálogos autorizados, nombres y horarios sin ampliar RLS', async () => {
    const result = await actor(() => api.agendaSiteAdministration(auth, site)); expect(result.services).toContainEqual({ id: service, name: 'Corte', duration: 30 }); expect(result.people).toContainEqual({ id: staff, name: 'Ana', scheduled: true })
    await expect(actor(() => api.agendaSiteAdministration({ ...auth, tenantId: foreignTenant }, site))).rejects.toMatchObject({ statusCode: 403 })
  })
  it('guardar y publicar conserva los marcadores originales y devuelve advertencias fuertes', async () => {
    const html = '{{agenda-component servicio="corte"}}{{agenda-component}}<button {{openAgenda personal="no-existe"}}>Abrir</button>{{agenda-algo}}'
    const saved = await actor(() => sites.saveSitePageDraft(tenant, user, site, page, { title: 'Inicio', path: '/', html, css: '' })); expect(saved!.agendaWarnings.some(w => w.includes('Advertencia fuerte'))).toBe(true); expect(saved!.agendaWarnings.some(w => w.includes('no-existe'))).toBe(true)
    const published = await actor(() => sites.publishSitePage(tenant, user, site, page)); expect(published!.agendaWarnings.some(w => w.includes('Solo se admite'))).toBe(true)
    const [version] = await admin`select v.html from site_pages p join site_page_versions v on v.id=p.published_version_id where p.id=${page}`; expect(version!.html).toBe(html)
    const detail = await actor(() => sites.getSitePage(tenant, site, page)); expect(detail!.agendaWarnings).toEqual(published!.agendaWarnings)
  })
  it('renderiza IDs públicos, ambos marcadores y sin runtime al desactivar; sin crear reservas', async () => {
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, serviceIds: [service], personalIds: [staff] }))
    const domain = await import('../../server/utils/siteDomains')
    const published = await domain.resolvePublishedPreview(site, '/'); expect(published).not.toBeNull()
    const context = await api.resolveAgendaContext(site, page, { origin: 'http://localhost:3000', host: 'localhost:3000', ip: '', userAgent: '' })
    const presentation = await api.publicAgendaPresentation(context, 'es-MX'); const html = domain.renderPublicSiteDocument(published!, presentation, 'nonce')
    expect(html).toContain('data-flow-agenda="inline"'); expect(html).toContain('data-flow-agenda-open'); expect(html).toContain('data-flow-agenda-runtime nonce="nonce"'); expect(html).not.toContain(service); expect(html).not.toContain(staff)
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: false })); await expect(api.publicAgendaPresentation(context, 'es')).rejects.toMatchObject({ statusCode: 404 })
    expect(domain.renderPublicSiteDocument(published!)).not.toContain('data-flow-agenda-runtime'); const [count] = await admin`select count(*)::int as count from agenda_public_bookings where tenant_id=${tenant}`; expect(count!.count).toBe(0)
  })
  it('páginas sin marcadores se conservan idénticas antes y después de activar agenda', async () => {
    const domain = await import('../../server/utils/siteDomains'); const published = await domain.resolvePublishedPreview(site, '/'); const original = { ...published!, html: '<main><h1>Mi sitio</h1><p>Texto sin agenda</p></main>' }
    const before = domain.renderPublicSiteDocument(original); await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true })); const context = await api.resolveAgendaContext(site, page, { origin: 'http://localhost:3000', host: 'localhost:3000', ip: '', userAgent: '' }); const config = await api.publicAgendaPresentation(context, 'es'); expect(domain.renderPublicSiteDocument(original, config)).toBe(before)
  })
  it('hereda el modo automático y avisa al ignorar personal, con prevalencia del ajuste del sitio', async () => {
    await admin`update agenda_settings set assignment_mode='auto' where tenant_id=${tenant}`
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, assignmentMode: null }))
    const context = await api.resolveAgendaContext(site, page, { origin: 'http://localhost:3000', host: 'localhost:3000', ip: '', userAgent: '' })
    const automatic = await api.publicAgendaPresentation(context, 'es-MX'); expect(automatic.mode).toBe('auto'); expect(automatic.runtime.assignmentMode).toBe('auto')
    const saved = await actor(() => sites.saveSitePageDraft(tenant, user, site, page, { title: 'Inicio', path: '/', html: '{{agenda-component personal="ana"}}', css: '' })); expect(saved!.agendaWarnings.some(w => w.includes('automática'))).toBe(true)
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, assignmentMode: 'client_chooses' }))
    const explicit = await api.publicAgendaPresentation(context, 'es-MX'); expect(explicit.mode).toBe('client_chooses'); expect(explicit.runtime.assignmentMode).toBe('client_chooses')
  })
})


describe('Configuración demostrativa del editor ERD179', () => {
  it('lee configuración guardada bajo Sites y tenant, sin crear reservas', async () => {
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: true, accent: 'custom', accentColor: '#AbC', personalIds: [staff], serviceIds: [service] }))
    const detail = await actor(() => sites.getSitePage(tenant, site, page))
    expect(detail!.agendaPreview).toMatchObject({ settings: { accent: 'custom', accentColor: '#aabbcc' }, missing: [] })
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: false, personalIds: [staff], serviceIds: [service] }))
    const disabled = await actor(() => sites.getSitePage(tenant, site, page))
    expect(disabled!.agendaPreview.missing).toContain('Activa la agenda para este sitio.')
    await admin`update users set is_active=false where id=${staff}`
    const noStaff = await actor(() => sites.getSitePage(tenant, site, page))
    expect(noStaff!.agendaPreview.missing).toContain('Define el horario de al menos una persona visible.')
    // Admin de fábrica sigue contando; se limita explícitamente a Personal sin horario activo.
    await actor(() => api.agendaSiteAdministration(auth, site, { enabled: false, personalIds: [user] }))
    await admin`delete from agenda_schedules where tenant_id=${tenant} and user_id=${user}`
    const noSchedules = await actor(() => sites.getSitePage(tenant, site, page))
    expect(noSchedules!.agendaPreview.missing).toContain('Define el horario de al menos una persona visible.')
    await admin`update records set deleted_at=now() where id=${service}`
    const noServices = await actor(() => sites.getSitePage(tenant, site, page))
    expect(noServices!.agendaPreview.missing).toContain('Agrega al menos un servicio visible.')
    const [count] = await admin`select count(*)::int n from agenda_public_bookings where tenant_id=${tenant}`
    expect(count!.n).toBe(0)
    await expect(actor(() => sites.getSitePage(foreignTenant, site, page))).resolves.toBeNull()
  })
})
