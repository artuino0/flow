// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeAgendaMarkers, transformAgendaMarkers } from '../../utils/agendaMarkers'
import { agendaButtonContrast, bootPublicAgenda, publicAgendaRuntime } from '../../utils/publicAgendaRuntime'
import { renderPublicSiteDocument } from '../../server/utils/siteDomains'
import { renderAgendaManagementDocument } from '../../server/utils/agendaManagementDocument'

const service = 'a'.repeat(32), person = 'b'.repeat(32), token = 't'.repeat(43)
const config = { enabled: true, services: [{ id: service, name: 'Corte' }], people: [{ id: person, name: 'Ana' }] }
const runtime = { site: 's', page: 'p', locale: 'es-MX', timezone: 'America/Mexico_City', accent: 'rgb(0 110 132)' }
const catalog = () => ({ services: config.services, people: config.people, mode: 'both', requiredFields: ['name', 'email'], requireConsent: true, formToken: 'signed', slots: [{ date: '2026-10-05', time: '09:00', timezone: runtime.timezone, personal: person }], automatic: [{ date: '2026-10-05', time: '09:00', timezone: runtime.timezone, personal: 'any' }] })
const confirmation = { date: '2026-10-05', time: '09:00', timezone: runtime.timezone, services: ['Corte'], personal: 'Ana', message: 'Listo', token }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const disposers: Array<() => void> = []
// jsdom no implementa inert; reproducción del atributo booleano del navegador.
Object.defineProperty(HTMLElement.prototype, 'inert', { configurable: true, get() { return this.hasAttribute('inert') }, set(value: boolean) { this.toggleAttribute('inert', value) } })
function mockApi(failure?: { path: string; status?: number; network?: boolean }, empty = false) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (failure && input.includes(failure.path)) { if (failure.network) throw new TypeError('offline'); return { ok: false, status: failure.status, json: async () => ({}) } }
    return { ok: true, status: 200, json: async () => input.includes('/slots?') ? { ...catalog(), ...(empty ? { slots: [], automatic: [] } : {}) } : confirmation }
  }); vi.stubGlobal('fetch', fetch); return fetch
}
async function mount(modal = false, management = false) {
  document.body.innerHTML = modal ? '<button data-flow-agenda-open>Abrir</button><a data-flow-agenda-open>Otro</a>' : management ? '<main data-flow-agenda-management></main>' : '<div data-flow-agenda="inline"></div>'
  disposers.push(bootPublicAgenda({ ...runtime, management }))
  if (modal) document.querySelector<HTMLButtonElement>('button')!.click()
  await flush()
  return document.querySelector<HTMLElement>(modal ? 'body > div' : management ? 'main' : 'div')!.shadowRoot!
}
async function fill(root: ShadowRoot) {
  await advanceData(root)
  for (const [name, value] of [['name', 'Visitante'], ['email', 'ana@example.test']]) {
    const input = root.querySelector<HTMLInputElement>(`[name=${name}]`)!; input.value = value!; input.dispatchEvent(new Event('input'))
  }
  const consent = root.querySelector<HTMLInputElement>('[type=checkbox]'); if (consent) { consent.checked = true; consent.dispatchEvent(new Event('change')) }
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000)
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await flush()
}
async function advanceDate(root: ShadowRoot) {
  for (let i = 0; i < 3 && !root.querySelector('.slots'); i++) {
    root.querySelector<HTMLButtonElement>('.footer button.primary')!.click(); await flush()
  }
}
async function advanceData(root: ShadowRoot) {
  if (root.querySelector('form')) return
  await advanceDate(root); root.querySelector<HTMLButtonElement>('.slots button')!.click()
  root.querySelector<HTMLButtonElement>('.footer button.primary')!.click(); await flush()
}
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.innerHTML = ''; document.body.style.overflow = ''; history.replaceState(null, '', '/'); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Marcadores de agenda, gramática y aislamiento', () => {
  it.each(['{{agenda-component}}', '{{ AGENDA-COMPONENT }}', '{{ agenda-component servicio="corte" personal=\'ana\' }}'])('acepta %s', html => {
    const result = transformAgendaMarkers(html, config); expect(result.active).toBe(1); expect(result.html).toContain('data-flow-agenda="inline"'); expect(result.warnings).toEqual([])
  })
  it.each(['<button {{openAgenda}}>Abrir</button>', '<a {{ OPENAGENDA personal="ana" }}>Abrir</a>'])('acepta atributos %s', html => {
    const result = transformAgendaMarkers(html, config); expect(result.active).toBe(1); expect(result.html).toContain('data-flow-agenda-open')
  })
  it.each(['<script>{{agenda-component}}</script>', '<!-- {{agenda-component}} -->', '<div title="{{agenda-component}}">Texto</div>', '<button value={{openAgenda}}>Texto</button>', '<style>{{agenda-component}}</style>', '<textarea>{{agenda-component}}</textarea>', '<template>{{agenda-component}}</template>', '<svg><text>{{agenda-component}}</text></svg>'])('ignora contextos %s', html => { expect(analyzeAgendaMarkers(html)).toEqual([]); expect(transformAgendaMarkers(html, config).html).toBe(html) })
  it.each(['{{agenda-algo}}', '{{agenda-component servicio=corte}}', '{{agenda-component otro="x"}}', '{{agenda-component servicio="<img onerror=x>"}}', '{{agenda-component servicio="a" servicio="b"}}', '{{agenda-component', '{{openAgenda}}', '<div {{openAgenda}}>Texto</div>', '<button data-x{{openAgenda}}>Texto</button>'])('no ejecuta %s', html => { const result = transformAgendaMarkers(html, config); expect(result.active).toBe(0); expect(result.warnings.length).toBeGreaterThan(0); expect(result.html).not.toContain('data-flow-agenda="inline"'); expect(result.html).not.toContain('data-flow-agenda-open') })
  it('resuelve slugs e IDs, ignora parámetros inexistentes y escapa IDs', () => {
    expect(transformAgendaMarkers('{{agenda-component servicio="corte" personal="ana"}}', config).html).toContain(`data-flow-agenda-servicio="${service}"`)
    expect(transformAgendaMarkers(`{{agenda-component servicio="${service}"}}`, config).warnings).toEqual([])
    const unknown = transformAgendaMarkers('{{agenda-component servicio="no-existe"}}', config); expect(unknown.active).toBe(1); expect(unknown.warnings[0]).toContain('se ignoró')
    const attack = transformAgendaMarkers('{{agenda-component servicio="corte"}}', { ...config, services: [{ id: '"><script>alert(1)</script>', name: 'Corte' }] }); expect(attack.html).not.toContain('<script>'); expect(attack.html).toContain('&lt;script&gt;')
  })
  it('ignora preselección de persona en modo auto con aviso', () => {
    const result = transformAgendaMarkers('{{agenda-component personal="ana"}}', { ...config, mode: 'auto' })
    expect(result.active).toBe(1); expect(result.html).not.toContain('data-flow-agenda-personal'); expect(result.warnings.some(w => w.includes('automát'))).toBe(true)
  })
  it('limita inline a uno, admite múltiples aperturas y avisa agenda vacía/desactivada', () => {
    const html = '{{agenda-component}}{{agenda-component}}<button {{openAgenda}}>1</button><a {{openAgenda}}>2</a>'
    expect(transformAgendaMarkers(html, config).active).toBe(3); expect(transformAgendaMarkers(html, config).warnings).toContain('Solo se admite un agenda-component por página.')
    const disabled = transformAgendaMarkers(html, { enabled: false, services: [], people: [] }); expect(disabled.active).toBe(0); expect(disabled.warnings.some(w => w.includes('Advertencia fuerte'))).toBe(true)
  })
  it('render público con ambos marcadores, nonce, desactivación y páginas existentes', () => {
    const page = { siteId: 's', pageId: 'p', siteName: 'Sitio', siteLocale: 'es-MX', pageTitle: 'Inicio', pagePath: '/', seo: {}, html: '{{agenda-component}}<button {{openAgenda}}>Abrir</button>', css: '' }
    const html = renderPublicSiteDocument(page, { ...config, runtime }, 'abc'); expect(html).toContain('data-flow-agenda-runtime nonce="abc"'); expect(html).toContain('data-flow-agenda-open')
    expect(renderPublicSiteDocument(page)).not.toContain('data-flow-agenda-runtime')
    const existing = { ...page, html: '<main>Mi página</main>' }; expect(renderPublicSiteDocument(existing, { ...config, runtime })).toBe(renderPublicSiteDocument(existing)); expect(renderPublicSiteDocument(existing)).not.toContain('data-flow-agenda-runtime')
  })
})

describe('Runtime público sin red', () => {
  it.each(['auto', 'client_chooses', 'both'])('respeta el modo %s y las opciones que ofrece la API', async mode => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/slots?') ? { ...catalog(), mode, people: mode === 'auto' ? [] : config.people } : confirmation })); vi.stubGlobal('fetch', fetch)
    document.body.innerHTML = `<div data-flow-agenda="inline" data-flow-agenda-personal="${person}"></div>`; disposers.push(bootPublicAgenda({ ...runtime, assignmentMode: mode })); await flush(); const root = document.querySelector('div')!.shadowRoot!
    expect(root.querySelector('.options')?.textContent).toContain('Corte'); expect(root.querySelector('form')).toBeNull(); root.querySelector<HTMLButtonElement>('.footer button.primary')!.click(); await flush()
    if (mode === 'auto') { expect(root.querySelector('.slots')).not.toBeNull(); expect(fetch.mock.calls.every(([url]) => !url.includes('personal=' + person))).toBe(true); expect(fetch.mock.calls.some(([url]) => url.includes('personal=any'))).toBe(true) }
    else { const options = Array.from(root.querySelectorAll('.people button')); expect(options.some(b => b.textContent?.includes('Ana'))).toBe(true); expect(options.some(b => b.textContent?.includes('Cualquiera disponible'))).toBe(mode === 'both') }
  })
  it('calendario tiene nombres accesibles, rango acotado y devuelve el foco al cambiar de mes', async () => {
    mockApi(); const root = await mount(); await advanceDate(root); const days = Array.from(root.querySelectorAll<HTMLButtonElement>('.calendar-grid button'))
    expect(days.length).toBeGreaterThanOrEqual(28); expect(days.every(b => !!b.getAttribute('aria-label'))).toBe(true); expect(days.filter(b => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    const next = root.querySelector<HTMLButtonElement>('[aria-label="Mes siguiente"]')!; if (!next.disabled) { next.click(); const nextAfter = root.querySelector<HTMLButtonElement>('[aria-label="Mes siguiente"]')!; expect(root.activeElement?.getAttribute('aria-label')).toBe(nextAfter.disabled ? 'Mes anterior' : 'Mes siguiente'); expect((root.activeElement as HTMLButtonElement).disabled).toBe(false) }
    expect(root.querySelector<HTMLButtonElement>('.footer button.primary')!.disabled).toBe(true)
  })
  it('validación marca los campos y conserva datos sin enviar una reserva', async () => {
    const fetch = mockApi(); const root = await mount(); await advanceData(root); root.querySelector<HTMLButtonElement>('.footer button.primary')!.click(); await flush()
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Revisa'); expect(root.querySelector('[name=name]')?.getAttribute('aria-invalid')).toBe('true'); expect(root.activeElement).toBe(root.querySelector('[name=name]')); expect(fetch.mock.calls.some(([url]) => url.includes('/book'))).toBe(false)
  })
  it('conserva foco en tarjetas y fecha seleccionada al recargar disponibilidad', async () => {
    mockApi(); const root = await mount(); const serviceOption = root.querySelector<HTMLButtonElement>('.option')!; serviceOption.focus(); serviceOption.click(); await flush(); expect(root.activeElement).toBe(root.querySelector('.option[aria-pressed=true]'))
    await advanceDate(root); const day = Array.from(root.querySelectorAll<HTMLButtonElement>('.calendar-grid button')).find(b => !b.disabled)!; day.focus(); day.click(); await flush(); expect(root.activeElement).toBe(root.querySelector('.calendar-grid button[aria-pressed=true]'))
  })
  it('token ausente o inválido conserva Shadow DOM, no solicita red y elimina query y fragmento', async () => {
    const fetch = mockApi(); history.replaceState(null, '', '/agenda-manage/s/p?agenda=secreto#agenda=mal'); const root = await mount(false, true)
    expect(location.search).toBe(''); expect(location.hash).toBe(''); expect(root.textContent).toContain('Este enlace ya no está disponible'); expect(fetch).not.toHaveBeenCalled()
  })
  it('reserva con consentimiento, honeypot y mínimo de tiempo, confirma y mantiene XSS como texto', async () => {
    const fetch = mockApi(); const root = await mount(); await advanceData(root); expect(root.querySelector('[name=_flow_honeypot]')).not.toBeNull(); expect(root.querySelector('.trap')?.getAttribute('aria-hidden')).toBe('true')
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await flush(); expect(fetch.mock.calls.some(([url]) => url.includes('/book'))).toBe(false)
    await fill(root); const call = fetch.mock.calls.find(([url]) => url.includes('/book'))!; expect(call[1]?.credentials).toBe('omit'); expect(JSON.parse(call[1]!.body as string)).toMatchObject({ site: 's', page: 'p', services: [service], personal: 'any', client: { name: 'Visitante' }, _flow_honeypot: '', formToken: 'signed', consent: true }); expect(root.textContent).toContain('¡Listo, tu cita está confirmada!')
    fetch.mockImplementation(async input => ({ ok: true, status: 200, json: async () => ({ ...confirmation, personal: '<img src=x onerror=alert(1)>', services: ['<script>alert(1)</script>'] }) }))
    Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Gestionar mi cita')!.click(); await flush(); expect(root.querySelector('img,script')).toBeNull(); expect(root.textContent).toContain('<img src=x')
  })
  it('impide enviar antes del tiempo mínimo y conserva el honeypot en cuerpo', async () => {
    const fetch = mockApi(); const root = await mount(); await advanceData(root)
    for (const name of ['name', 'email']) { const input = root.querySelector<HTMLInputElement>(`[name=${name}]`)!; input.value = name === 'email' ? 'a@b.test' : 'Ana'; input.dispatchEvent(new Event('input')) }
    const consent = root.querySelector<HTMLInputElement>('[type=checkbox]')!; consent.checked = true; consent.dispatchEvent(new Event('change'))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await flush(); expect(root.textContent).toContain('Espera un momento'); expect(fetch.mock.calls.some(([url]) => url.includes('/book'))).toBe(false)
    const trap = root.querySelector<HTMLInputElement>('[name=_flow_honeypot]')!; trap.value = 'bot'; trap.dispatchEvent(new Event('input')); await fill(root); expect(JSON.parse(fetch.mock.calls.find(([url]) => url.includes('/book'))![1]!.body as string)._flow_honeypot).toBe('bot')
  })
  it('409 vuelve a selección y no permite reservar el hueco perdido', async () => { const fetch = mockApi({ path: '/book', status: 409 }); const root = await mount(); await fill(root); expect(root.textContent).toContain('Ese horario se acaba de ocupar'); Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Elegir otro horario')!.click(); expect(root.querySelector<HTMLButtonElement>('.footer button.primary')!.disabled).toBe(true); expect(fetch.mock.calls.filter(([url]) => url.includes('/slots?')).length).toBeGreaterThan(2) })
  it('sin huecos permite explorar otros días', async () => { mockApi(undefined, true); const root = await mount(); await advanceDate(root); expect(root.textContent).toContain('No hay huecos libres'); expect(Array.from(root.querySelectorAll('button')).some(b => b.textContent === 'Ver otros días')).toBe(true) })
  it.each([{ status: 429, text: 'Hiciste muchos intentos seguidos' }, { network: true, text: 'No pudimos conectarnos' }, { status: 404, text: 'La agenda no está disponible' }])('errores y reintento %s', async failure => { mockApi({ path: '/slots?', ...failure }); const root = await mount(); expect(root.textContent).toContain(failure.text); expect(root.textContent).toContain('Reintentar') })
  it('modal: foco atrapado, Escape, cancelación del descarte, fondo inmóvil y devolución del foco', async () => {
    mockApi(); const root = await mount(true); const opener = document.querySelector<HTMLButtonElement>('button')!; expect(document.body.style.overflow).toBe('hidden'); expect(opener.inert).toBe(true); expect(root.querySelector('[role=dialog]')?.getAttribute('aria-modal')).toBe('true')
    const close = root.querySelector<HTMLButtonElement>('.close')!; expect(root.activeElement).toBe(close); close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); expect(root.activeElement).not.toBe(close)
    await advanceData(root); const input = root.querySelector<HTMLInputElement>('[name=name]')!; input.value = 'Ana'; input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(root.querySelector('[role=alertdialog]')?.getAttribute('aria-label')).toBe('¿Salir sin agendar?'); expect(root.host.isConnected).toBe(true)
    Array.from(root.querySelectorAll('.confirm-card button')).find(b => b.textContent === 'Seguir editando')!.dispatchEvent(new MouseEvent('click')); expect(root.querySelector('.confirm-overlay')).toBeNull(); expect(root.host.isConnected).toBe(true)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); Array.from(root.querySelectorAll('.confirm-card button')).find(b => b.textContent === 'Salir')!.dispatchEvent(new MouseEvent('click')); expect(root.host.isConnected).toBe(false); expect(document.activeElement).toBe(opener); expect(opener.inert).toBe(false); expect(document.body.style.overflow).toBe('')
  })
  it('gestión retira token del fragmento, usa header, cancela y reprograma en cuerpo con rotación', async () => {
    const fetch = mockApi(); history.replaceState(null, '', '/agenda-manage/s/p#agenda=' + token); let root = await mount(false, true); expect(location.hash).toBe(''); const call = fetch.mock.calls.find(([url]) => url.includes('/booking?'))!; expect(call[0]).not.toContain(token); expect(call[1]?.headers).toMatchObject({ 'X-Flow-Agenda-Token': token })
    Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Cancelar cita')!.click(); expect(root.querySelector('[role=alertdialog]')).not.toBeNull(); Array.from(root.querySelectorAll('.confirm-card button')).find(b => b.textContent === 'Sí, cancelar cita')!.dispatchEvent(new MouseEvent('click')); await flush(); expect(root.textContent).toContain('Tu cita fue cancelada'); expect(JSON.parse(fetch.mock.calls.find(([url]) => url.includes('/cancel'))![1]!.body as string).token).toBe(token)
    document.body.innerHTML = ''; history.replaceState(null, '', '/agenda-manage/s/p#agenda=' + token); root = await mount(false, true); Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Reprogramar cita')!.click(); await flush(); root.querySelector<HTMLButtonElement>('.slots button')!.click(); root.querySelector<HTMLButtonElement>('.footer button.primary')!.click(); await flush(); expect(root.textContent).toContain('Cita reprogramada'); expect(JSON.parse(fetch.mock.calls.find(([url]) => url.includes('/reschedule'))![1]!.body as string)).toMatchObject({ token, services: [service] })
  })
  it('preview nunca solicita red y serialización protege cierre de script', async () => {
    const fetch = mockApi(); document.body.innerHTML = '<div data-flow-agenda="inline"></div>'; disposers.push(bootPublicAgenda({ ...runtime, preview: true })); await flush(); const root = document.querySelector('div')!.shadowRoot!; await fill(root); expect(fetch).not.toHaveBeenCalled(); expect(root.textContent).toContain('no se crearán citas')
    expect(publicAgendaRuntime({ ...runtime, locale: '</script><script>alert(1)</script>' })).not.toContain('</script><script>')
  })
  it('ejecuta el script serializado real y respeta campos visibles sin red', async () => {
    const fetch = mockApi(); document.body.innerHTML = '<div data-flow-agenda="inline"></div>'
    const markup = publicAgendaRuntime({ ...runtime, preview: true, fields: ['email'], requiredFields: ['email'] })
    const script = markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</script>'))
    disposers.push(new Function('return ' + script)() as () => void); await flush(); const root = document.querySelector('div')!.shadowRoot!
    await advanceData(root); expect(root.querySelector('[name=email]')).not.toBeNull(); expect(root.querySelector('[name=name]')).toBeNull(); expect(root.querySelector('[name=phone]')).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
  it('gestión clara, sin cabecera, noindex, sin almacenamiento; contraste AA para todo RGB', () => {
    const html = renderAgendaManagementDocument(runtime); expect(html).toContain('noindex,nofollow'); expect(html).toContain('no-referrer'); expect(html).toContain('color-scheme:light'); expect(html).not.toContain('AppNav'); expect(html).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) expect(agendaButtonContrast([r, g, b]).ratio).toBeGreaterThanOrEqual(4.5)
  })
})
