import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { captureEdgeHost } from '../../server/utils/effectiveHost'
import { JSDOM } from 'jsdom'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { resetPublicRateLimits } from '../../server/utils/rateLimit'
import { bootPublicAgenda } from '../../utils/publicAgendaRuntime'
import { agendaBrowserHeaders } from '../helpers/agendaBrowserFetch'
import type { AuthTokenPayload } from '../../server/utils/auth'

vi.mock('../../server/utils/mailer', async original => ({ ...await original<typeof import('../../server/utils/mailer')>(), sendPlainEmail: vi.fn(async () => {}) }))
vi.mock('../../server/utils/triggers', () => ({ fireTriggersForRecord: vi.fn() }))
const site = randomUUID(), page = randomUUID(), tenant = randomUUID()
const now = Date.parse('2026-10-04T12:00:00Z'), flow = 'http://localhost:3000', custom = 'https://citas.example.test'
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db'), api: typeof import('../../server/utils/agendaPublic')
let slots: typeof import('../../server/api/public/agenda/slots.get').default
let booking: typeof import('../../server/api/public/agenda/booking.get').default
let book: typeof import('../../server/api/public/agenda/book.post').default
let cancel: typeof import('../../server/api/public/agenda/cancel.post').default
let reschedule: typeof import('../../server/api/public/agenda/reschedule.post').default
let dom: JSDOM | undefined, dispose: (() => void) | undefined
let edgeTransport = false

function event(url: string, method: string, headers: Record<string, string>, body?: unknown) {
  const req = new IncomingMessage(new Socket()); req.url = url; req.method = method; req.headers = edgeTransport ? { ...headers, host: 'origin.flow.test', 'x-forwarded-host': headers.host!, 'x-flow-edge-secret': 'simulated-edge' } : headers
  if (body !== undefined) req.push(typeof body === 'string' ? body : JSON.stringify(body))
  req.push(null); const result = createEvent(req, new ServerResponse(req)); captureEdgeHost(result); return result
}
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = flow
  await admin`insert into tenants(id,name,slug) values (${tenant},'Agenda 180',${'agenda180-' + tenant})`
  const [role] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`
  const [person] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x','Ana visible') returning id`
  const [user] = await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person!.id},${role!.id}) returning id`
  connection = await import('../../server/db'); api = await import('../../server/utils/agendaPublic')
  await (await import('../../server/utils/agendaTemplate')).installAgendaTemplate(tenant)
  await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-servicios'),'{"nombre":"Consulta","duracion_minutos":30,"precio":100}')`
  await admin`insert into sites(id,tenant_id,name,slug,status) values (${site},${tenant},'Sitio publicado',${'site-' + site},'published')`
  await admin`insert into site_pages(id,tenant_id,site_id,path,title,status) values (${page},${tenant},${site},'/','Inicio','published')`
  const [version] = await admin`insert into site_page_versions(tenant_id,site_id,page_id,version,status,html) values (${tenant},${site},${page},1,'published','<button {{openAgenda}}>Agenda tu cita</button>') returning id`
  await admin`update site_pages set published_version_id=${version!.id} where id=${page}`
  await admin`insert into site_domains(tenant_id,site_id,hostname,status) values (${tenant},${site},'citas.example.test','active')`
  await withRecordActor({ userId: user!.id, roleId: role!.id }, () => api.agendaSiteAdministration({ sub: user!.id, tenantId: tenant, roleId: role!.id } as AuthTokenPayload, site, { enabled: true, personalIds: [user!.id], cancellationHours: 1 }))
  slots = (await import('../../server/api/public/agenda/slots.get')).default
  booking = (await import('../../server/api/public/agenda/booking.get')).default
  book = (await import('../../server/api/public/agenda/book.post')).default
  cancel = (await import('../../server/api/public/agenda/cancel.post')).default
  reschedule = (await import('../../server/api/public/agenda/reschedule.post')).default
}, 90000)
beforeEach(() => { edgeTransport = false; resetPublicRateLimits(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now) })
afterEach(() => { dispose?.(); dispose = undefined; dom?.window.close(); dom = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetPublicRateLimits() })
afterAll(async () => { await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; delete process.env.APP_BASE_URL })
const query = `/api/public/agenda/slots?site=${site}&page=${page}&from=2026-10-05&to=2026-10-05`
const invalidHeaders: Record<string, string>[] = [
  { host: 'localhost:3000', origin: 'https://ajeno.test' },
  { host: 'otro.test', origin: flow },
  { host: 'localhost:3000' },
  { host: 'localhost:3000', referer: 'https://otro-sitio.test/pagina' },
  { host: 'localhost:3000', origin: 'null', referer: flow + '/sitio' },
  { host: 'ajeno.test', origin: 'https://ajeno.test' },
  { host: 'localhost:3000', origin: 'https://ajeno.test', referer: flow + '/sitio' }
]

describe('Agenda 180: runtime y handlers reales con cabeceras de navegador', () => {
  it.each([flow, custom])('GET mismo origen %s exige Referer y acepta la política elegida', async origin => {
    const url = `${origin}/site-preview/${site}`
    const missing = agendaBrowserHeaders(url, query, { referrerPolicy: 'no-referrer' })
    expect(missing.origin).toBeUndefined(); expect(missing.referer).toBeUndefined()
    await expect(slots(event(query, 'GET', missing))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
    const headers = agendaBrowserHeaders(url, query, { referrerPolicy: 'same-origin' })
    expect(headers.origin).toBeUndefined()
    await expect(slots(event(query, 'GET', headers))).resolves.toMatchObject({ services: [{ name: 'Consulta' }], people: [{ name: 'Ana visible' }] })
  })
  it.each(invalidHeaders)('rechaza cabeceras ajenas o ausentes %j sin revelar el motivo', async headers => {
    await expect(slots(event(query, 'GET', { ...headers, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.', stack: '' })
  })
  it.each([{ origin: flow, edge: false }, { origin: custom, edge: false }, { origin: custom, edge: true }])('modal → catálogo → lunes → reserva → gestión y cambios desde $origin, borde=$edge', async ({ origin, edge }) => {
    if (edge) { vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge'); edgeTransport = true }
    dom = new JSDOM('<button data-flow-agenda-open>Agenda tu cita</button>', { url: `${origin}/site-preview/${site}?email=privado#dato=secreto`, pretendToBeVisual: true })
    for (const key of ['document', 'location', 'history', 'HTMLElement', 'Element', 'Event', 'getComputedStyle'] as const) vi.stubGlobal(key, dom.window[key])
    const calls: Array<{ url: string; init: RequestInit; headers: Record<string, string> }> = []
    let pending: Promise<unknown>[] = []
    const fetch = vi.fn((url: string, init: RequestInit = {}) => {
      const headers = agendaBrowserHeaders(dom!.window.location.href, url, init)
      calls.push({ url, init, headers })
      const handler = url.includes('/slots?') ? slots : url.includes('/booking?') ? booking : url.endsWith('/book') ? book : url.endsWith('/cancel') ? cancel : reschedule
      const request = handler(event(url, init.method ?? 'GET', headers, init.body))
      const response = Promise.resolve(request).then(data => ({ ok: true, status: 200, json: async () => data }), (error: { statusCode: number }) => ({ ok: false, status: error.statusCode, json: async () => ({}) }))
      pending.push(response); return response
    })
    vi.stubGlobal('fetch', fetch)
    async function settle() { do { const batch = pending; pending = []; await Promise.all(batch); for (let i = 0; i < 12; i++) await Promise.resolve() } while (pending.length) }
    const cfg = { site, page, locale: 'es-MX', timezone: 'America/Mexico_City', accent: 'rgb(0 110 132)' }
    dispose = bootPublicAgenda(cfg)
    dom.window.document.querySelector<HTMLButtonElement>('button')!.click(); await settle()
    let root = dom.window.document.querySelector<HTMLElement>('body > div')!.shadowRoot!
    expect(root.querySelector('.options')?.textContent).toContain('Consulta')
    root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle()
    expect(root.querySelector('.people')?.textContent).toContain('Ana visible')
    root.querySelector<HTMLButtonElement>('.people .option:last-child')!.click(); await settle()
    root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle()
    const monday = Array.from(root.querySelectorAll<HTMLButtonElement>('.calendar-grid button')).find(b => b.getAttribute('aria-label')?.includes('lunes, 5'))!
    expect(monday).toBeDefined(); monday.click(); await settle()
    root.querySelector<HTMLButtonElement>('.slots button')!.click()
    root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle()
    for (const [name, value] of [['name', 'Visitante 180'], ['email', randomUUID() + '@test.local']]) {
      const input = root.querySelector<HTMLInputElement>(`[name=${name}]`)!; input.value = value!; input.dispatchEvent(new dom.window.Event('input'))
    }
    vi.setSystemTime(now + 3000)
    root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle()
    expect(root.textContent).toContain('¡Listo, tu cita está confirmada!')
    const saved = await admin`select token_hash from agenda_public_bookings where site_id=${site} and status='active'`
    expect(saved.length).toBeGreaterThan(0)
    const bookCall = calls.find(call => call.url.endsWith('/book'))!
    expect(bookCall.headers.origin).toBe(origin); expect(bookCall.headers.referer).toBeUndefined()
    // Token entregado por el handler: se captura solo en memoria, como el runtime.
    const response = await fetch.mock.results.find((_, index) => calls[index]?.url.endsWith('/book'))!.value
    const confirmation = await response.json() as { token: string }
    const bookingUrl = `/api/public/agenda/booking?site=${site}&page=${page}`
    const tokenHeader = { 'X-Flow-Agenda-Token': confirmation.token }
    await expect(booking(event(bookingUrl, 'GET', agendaBrowserHeaders(dom.window.location.href, bookingUrl, { headers: tokenHeader, referrerPolicy: 'no-referrer' })))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
    await expect(booking(event(bookingUrl, 'GET', agendaBrowserHeaders(dom.window.location.href, bookingUrl, { headers: tokenHeader, referrerPolicy: 'same-origin' })))).resolves.toMatchObject({ services: ['Consulta'], personal: 'Ana visible' })
    if (edge) {
      const manage = (await import('../../server/routes/agenda-manage/[site]/[page].get')).default
      const request = event(`/agenda-manage/${site}/${page}`, 'GET', { host: new URL(origin).host })
      request.context.params = { site, page }
      const html = await manage(request)
      expect(html).toContain('data-flow-agenda-runtime'); expect(html).not.toContain('"unavailable":true')
      expect(request.node.res.getHeader('content-security-policy')).toContain("frame-ancestors 'none'")
      expect(request.node.res.getHeader('content-security-policy')).toContain("script-src-attr 'none'")
      expect(request.node.res.getHeader('cache-control')).toBe('no-store')
      expect(request.node.req.headers['x-flow-edge-secret']).toBeUndefined()
    }
    dispose(); dom.window.document.body.innerHTML = '<main data-flow-agenda-management></main>'
    dom.window.history.replaceState(null, '', `/agenda-manage/${site}/${page}?descartar=1#agenda=${confirmation.token}`)
    dispose = bootPublicAgenda({ ...cfg, management: true }); await settle()
    root = dom.window.document.querySelector('main')!.shadowRoot!
    expect(root.textContent).toContain('Tu cita'); expect(dom.window.location.hash).toBe(''); expect(dom.window.location.search).toBe('')
    const managementCall = calls.find(call => call.url.includes('/booking?'))!
    expect(managementCall.headers['x-flow-agenda-token']).toBe(confirmation.token)
    expect(managementCall.headers.referer).toBe(`${origin}/agenda-manage/${site}/${page}`)
    const click = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text)!.click()
    click('Reprogramar cita'); await settle()
    Array.from(root.querySelectorAll<HTMLButtonElement>('.calendar-grid button')).find(b => b.getAttribute('aria-label')?.includes('lunes, 5'))!.click(); await settle()
    root.querySelector<HTMLButtonElement>('.slots button')!.click(); root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle()
    expect(root.textContent).toContain('Cita reprogramada')
    click('Gestionar mi cita'); await settle(); click('Cancelar cita'); click('Sí, cancelar cita'); await settle()
    expect(root.textContent).toContain('Tu cita fue cancelada')
    for (const call of calls) {
      expect(call.init.credentials).toBe('omit'); expect(call.url).not.toContain(confirmation.token); expect(call.headers.referer ?? '').not.toContain(confirmation.token)
      expect(call.headers.referer ?? '').not.toMatch(/privado|secreto|email=|#|\?/)
      expect(call.headers).toMatchObject({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })
      if (call.init.method === 'GET') { expect(call.headers.origin).toBeUndefined(); expect(call.headers.referer).toBeDefined() }
      else { expect(call.headers.origin).toBe(origin); expect(call.headers.referer).toBeUndefined() }
    }
    expect(calls.some(call => call.url.endsWith('/reschedule'))).toBe(true); expect(calls.some(call => call.url.endsWith('/cancel'))).toBe(true)
  })
  it('Cloudflare rechaza host suplantado, secreto incorrecto, null y dominio inactivo', async () => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge')
    for (const secret of ['', 'incorrecto']) {
      await expect(slots(event(query, 'GET', { host: 'origin.flow.test', 'x-forwarded-host': new URL(custom).host, 'x-flow-edge-secret': secret, origin: custom }))).rejects.toMatchObject({ statusCode: 404 })
    }
    await expect(slots(event(query, 'GET', { host: 'origin.flow.test', 'x-forwarded-host': new URL(custom).host, 'x-flow-edge-secret': 'simulated-edge', origin: 'null', referer: custom }))).rejects.toMatchObject({ statusCode: 404 })
    await admin`update site_domains set status='pending' where site_id=${site}`
    try {
      await expect(slots(event(query, 'GET', { host: 'origin.flow.test', 'x-forwarded-host': new URL(custom).host, 'x-flow-edge-secret': 'simulated-edge', origin: custom }))).rejects.toMatchObject({ statusCode: 404 })
    } finally { await admin`update site_domains set status='active' where site_id=${site}` }
  })
  it('diagnóstico solo en consola de desarrollo, motivos fijos y respuesta genérica', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'development')
    await expect(slots(event(query, 'GET', { host: 'localhost:3000' }))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
    expect(warn).toHaveBeenLastCalledWith('[Agenda pública] Sin origen: faltan Origin y Referer válido.')
    await expect(slots(event(query, 'GET', { host: 'localhost:3000', origin: 'https://privado.test' }))).rejects.toMatchObject({ statusCode: 404 })
    expect(warn).toHaveBeenLastCalledWith('[Agenda pública] El origen no coincide con Host.')
    await expect(slots(event(query, 'GET', { host: 'ajeno.test', origin: 'https://ajeno.test' }))).rejects.toMatchObject({ statusCode: 404 })
    expect(warn).toHaveBeenLastCalledWith('[Agenda pública] El dominio no está activo para este sitio.')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('privado.test')
    warn.mockClear(); vi.stubEnv('NODE_ENV', 'production')
    await expect(slots(event(query, 'GET', { host: 'localhost:3000' }))).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Agenda no disponible.' })
    expect(warn).not.toHaveBeenCalled()
  })
})
