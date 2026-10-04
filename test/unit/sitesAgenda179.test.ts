// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, Suspense, watch, type App } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import * as publicTypes from '../../utils/agendaPublic'
import * as accent from '../../utils/agendaAccent'
import * as publicRuntime from '../../utils/publicAgendaRuntime'
import * as administration from '../../utils/agendaAdministration'
import { siteNavigation } from '../../utils/siteNavigation'
import { lightTokens, darkTokens } from '../../utils/themeTokens'
import { auditThemeSource } from '../../scripts/auditThemeColors'
import { compileVueComponent } from '../helpers/vueComponent'
import { registerAgendaAdministrationComponents } from '../helpers/agendaAdministrationView'

const file = 'pages/sites/[siteId]/agenda/index.vue'
const apps: App[] = []
const fixture = () => ({ settings: publicTypes.agendaSiteSettingsSchema.parse({}), available: true, reason: null as string | null, services: [{ id: 'service', name: 'Consulta' }], people: [{ id: 'person', name: 'Ana', scheduled: true }, { id: 'other', name: 'Pedro', scheduled: false }], recent: [] as Array<{ id: string; status: string; date: string; time: string; personal: string; services: string[] }> })
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); await nextTick() }
async function mount(options: { loadError?: unknown; saveError?: unknown; pending?: boolean; empty?: boolean; response?: ReturnType<typeof fixture>; pages?: Array<{ id: string; path: string; publishedVersionId: string | null }>; html?: string; publicationError?: unknown } = {}) {
  apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''
  const data = ref(options.empty ? null : options.response ?? fixture()), loadError = ref(options.loadError ?? null)
  const refresh = vi.fn(async () => { loadError.value = null }), refreshSite = vi.fn()
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith('/site-preview/')) { if (options.publicationError) throw options.publicationError; return options.html ?? '<h1>Página sin agenda</h1>' }
    if (options.saveError) throw options.saveError
    return data.value
  })
  const component = compileVueComponent(file, { '~/utils/agendaAccent': accent, '~/utils/agendaPublic': publicTypes, '~/utils/publicAgendaRuntime': publicRuntime, '~/utils/agendaAdministration': administration }, { reactive, ref, toRaw, computed, watch, onMounted, onBeforeUnmount, useRoute: () => ({ params: { siteId: 'site' } }), useFetch: async (url: string) => url.startsWith('/api/sites/') ? { data: ref({ pages: options.pages ?? [] }), error: ref(null), pending: ref(false), refresh: refreshSite } : { data, error: loadError, pending: ref(!!options.pending), refresh }, useRequestHeaders: () => ({}), definePageMeta: vi.fn(), $fetch: fetch })
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component) }) }); registerAgendaAdministrationComponents(app)
  const host = document.createElement('div'); document.body.append(host); app.mount(host); apps.push(app); await settle()
  return { host, data, refresh, refreshSite, fetch }
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('Sites: estructura y navegación compartidas', () => {
  it('ninguna pantalla /sites/** tiene un main suelto en su plantilla', () => {
    const files = readdirSync('pages/sites', { recursive: true }).filter(name => typeof name === 'string' && name.endsWith('.vue')) as string[]
    expect(files.length).toBeGreaterThan(15)
    for (const name of files) {
      const ast = parse(readFileSync(path.join('pages/sites', name), 'utf8')).descriptor.template?.ast
      const visit = (node: { tag?: string; children?: unknown[] }) => {
        expect(node.tag, name).not.toBe('main')
        // Un main dentro del workspace del editor no es un main suelto de página.
        if (!node.tag || node.tag === 'template') node.children?.forEach(child => visit(child as typeof node))
      }
      if (ast) visit(ast)
    }
  })
  it.each([320, 390, 768, 1440])('contrato CSS del scroll propio a %i px, sin otro scroll vertical en listas', width => {
    const styles = parse(readFileSync('components/SitesAdminPage.vue', 'utf8')).descriptor.styles[0]!.content
    const declarations: Record<string, string> = {}
    postcss.parse(styles).walkRules('.sites-admin-page', rule => {
      const parent = rule.parent
      if (parent?.type === 'atrule' && parent.name === 'media') { const max = /max-width:(\d+)px/.exec(parent.params); if (max && width > Number(max[1])) return }
      rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value })
    })
    expect(declarations).toMatchObject({ height: '100%', 'min-height': '0', 'min-width': '0', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'box-sizing': 'border-box' })
    expect(readFileSync('layouts/default.vue', 'utf8')).toContain("fullBleedRoute ? 'overflow-hidden p-0'")
    const page = readFileSync(file, 'utf8'); expect(page).toContain('<SitesAdminPage'); expect(page).not.toContain('max-h-56'); expect(page).not.toContain('overflow-auto')
  })
  it('conserva Agenda una sola vez en el menú lateral y no duplica una navegación horizontal en la pantalla', async () => {
    const items = siteNavigation('site').flatMap(section => section.items)
    expect(items.map(item => item.label)).toEqual(['Todos los sitios', 'Resumen', 'Páginas', 'Landing pages', 'Formularios', 'Agenda', 'Publicaciones', 'Dominios y URLs', 'Analítica', 'Configuración'])
    expect(readFileSync('components/AppNav.vue', 'utf8')).toContain('siteId ? siteNavigation(siteId)')
    const { host } = await mount()
    expect(host.querySelector('.list-page-header h1')?.textContent).toBe('Agenda del sitio')
    expect(host.querySelector('nav[aria-label="Secciones del sitio"]')).toBeNull()
    expect(host.querySelector('.site-navigation')).toBeNull()
    expect(host.querySelectorAll('nav')).toHaveLength(1)
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Migas de pan')
    expect(existsSync('components/SitesSiteNavigation.vue')).toBe(false)
    expect(host.querySelector('.sites-admin-page')?.getAttribute('tabindex')).toBe('0')
    expect(host.querySelectorAll('.agenda-choice-group')).toHaveLength(2)
    expect(host.querySelectorAll('.settings-card')).toHaveLength(6)
    expect(host.querySelectorAll('.agenda-card-heading')).toHaveLength(6)
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts allow-modals')
    host.querySelector<HTMLElement>('button.primary-button')!.focus(); expect(document.activeElement?.textContent).toBe('Guardar cambios')
  })
  it('el selector real admite teclado y conserva el valor de herencia', async () => {
    const { host, fetch } = await mount()
    const trigger = host.querySelector<HTMLInputElement>('.agenda-choice-group input:checked')!; trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await nextTick()
    expect(document.activeElement?.getAttribute('type')).toBe('radio')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await nextTick()
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await nextTick()
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await nextTick()
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(fetch).toHaveBeenCalledWith('/api/agenda/site-settings', expect.objectContaining({ body: expect.objectContaining({ settings: expect.objectContaining({ assignmentMode: 'both' }) }) }))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await nextTick()
    expect((document.activeElement as HTMLInputElement).checked).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(fetch).toHaveBeenLastCalledWith('/api/agenda/site-settings', expect.objectContaining({ body: expect.objectContaining({ settings: expect.objectContaining({ assignmentMode: null }) }) }))
  })
})

describe('Lista de requisitos de la configuración guardada', () => {
  it.each(Array.from({ length: 64 }, (_, mask) => mask))('combina los requisitos sin confundir selección vacía con nadie visible: %i', mask => {
    const value = fixture(); const bit = (index: number) => !!(mask & (1 << index))
    value.available = bit(0) && bit(2); value.reason = !bit(0) ? 'Instala Citas base.' : !bit(2) ? 'Configura horarios del personal.' : null
    value.services = bit(1) ? value.services : []; value.people[0]!.scheduled = bit(2)
    value.settings.personalIds = bit(3) ? [] : ['other']; value.settings.enabled = bit(4)
    expect(administration.agendaReadiness(value, 'site', bit(5) ? '/site-preview/site' : null).map(item => item.ready)).toEqual([bit(0), bit(1), bit(2), bit(2) && bit(3), bit(4), bit(5)])
  })
  it('todo pendiente: seis textos, iconos y caminos accionables', async () => {
    const value = fixture(); value.available = false; value.reason = 'Instala Citas base.'; value.services = []; value.people = []
    const { host } = await mount({ response: value })
    expect(host.querySelectorAll('[data-ready=false]')).toHaveLength(6)
    expect(host.querySelector('.checklist')?.textContent?.match(/Pendiente/g)).toHaveLength(6)
    expect(host.querySelector('a[href="/modulos/nuevo"]')).not.toBeNull(); expect(host.querySelector('a[href="/registros/agenda-servicios"]')).not.toBeNull(); expect(host.querySelector('a[href="/ajustes?section=agenda"]')).not.toBeNull()
  })
  it('parcial: activar sin guardar no declara que la agenda pública está lista', async () => {
    const { host } = await mount()
    expect(host.querySelectorAll('[data-ready=true]')).toHaveLength(4)
    const checkbox = host.querySelector<HTMLInputElement>('#agenda-enabled')!; checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); await nextTick()
    expect(host.querySelector('[data-requirement=enabled]')?.getAttribute('data-ready')).toBe('false')
    expect(host.textContent).not.toContain('Tu agenda está lista')
  })
  it('completo: verifica publicación, no borrador, y enlaza su ruta pública', async () => {
    const response = fixture(); response.settings.enabled = true
    const { host, fetch } = await mount({ response, pages: [{ id: 'draft', path: '/borrador', publishedVersionId: null }, { id: 'pub', path: '/reservar', publishedVersionId: 'version' }], html: '<div data-flow-agenda="inline"></div><script>throw new Error("No ejecutar")</script>' })
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledWith('/site-preview/site/reservar', { responseType: 'text' })
    expect(host.querySelectorAll('[data-ready=true]')).toHaveLength(6); expect(host.textContent).toContain('Tu agenda está lista')
    expect(host.querySelector('a[href="/site-preview/site/reservar"]')?.getAttribute('rel')).toBe('noopener noreferrer')
  })
  it('fallo en comprobación de publicación queda pendiente y se explica', async () => {
    const { host } = await mount({ pages: [{ id: 'pub', path: '/', publishedVersionId: 'v' }], publicationError: { statusCode: 500 } })
    expect(host.textContent).toContain('No pudimos comprobar la página publicada'); expect(host.querySelector('[data-requirement=published]')?.getAttribute('data-ready')).toBe('false')
  })
  it.each(['{{agenda-component}}', '<button {{openAgenda}}>Reservar</button>', '<div data-flow-agenda="inline"></div>', '<a data-flow-agenda-open>Reservar</a>'])('reconoce marcadores originales o transformados: %s', html => expect(administration.publishedDocumentHasAgenda(html)).toBe(true))
  it.each(['<script>"{{agenda-component}}";"<div data-flow-agenda=inline></div>"</script>', '<!-- <button data-flow-agenda-open></button> {{agenda-component}} -->', '<template><div data-flow-agenda="inline"></div></template>', '<span title="{{agenda-component}}">Sin agenda</span>', '<h1>Sin agenda</h1>', '{{agenda-desconocida}}'])('descarta textos inertes o inválidos: %s', html => expect(administration.publishedDocumentHasAgenda(html)).toBe(false))
})

describe('Carga y guardado: errores específicos sin red', () => {
  const cases = [
    { error: { statusCode: 403 }, message: 'No tienes permiso para administrar la agenda. Pídele acceso a un administrador' },
    { error: { statusCode: 404 }, message: 'No encontramos este sitio' },
    { error: { statusCode: 422, data: { statusMessage: 'Configura horarios para activar la agenda.' } }, message: 'Configura horarios para activar la agenda.' },
    { error: { response: { status: 409 }, data: { statusMessage: 'La configuración cambió. Recarga antes de guardar.' } }, message: 'La configuración cambió. Recarga antes de guardar.' },
    { error: new TypeError('Failed to fetch'), message: 'Sin conexión. Reintenta' },
    { error: { statusCode: 500, data: { statusMessage: 'relation agenda_schedules does not exist' } }, message: 'por un error del servidor' }
  ]
  it.each(cases)('carga y guardado muestran $message, conservan formulario y reintento', async ({ error, message }) => {
    let result = await mount({ loadError: error }); expect(result.host.querySelector('[role=alert]')?.textContent).toContain(message)
    const retry = [...result.host.querySelectorAll('button')].find(button => button.textContent === 'Reintentar')!; retry.click(); await settle(); expect(result.refresh).toHaveBeenCalled(); expect(result.refreshSite).toHaveBeenCalled()
    result = await mount({ saveError: error }); result.host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(result.host.querySelector('[role=alert]')?.textContent).toContain(message); expect(result.host.querySelector('form')).not.toBeNull(); expect(result.host.querySelector('#agenda-enabled')).not.toBeNull()
    expect(result.host.textContent).not.toContain('relation agenda_schedules'); if (!message.includes('permiso')) expect(result.host.textContent).not.toContain('Pídele acceso')
  })
  it.each([422, 409])('no expone detalles internos o trazas en %i', status => {
    for (const statusMessage of ['SELECT password FROM users', 'Error\n at node_modules/x.js:1', 'postgres://secret', '<script>oops</script>']) expect(administration.agendaAdministrationError({ statusCode: status, data: { statusMessage } }, 'save')).toBe('Revisa la configuración de la agenda y vuelve a intentarlo.')
  })
  it('distingue cargar de guardar en 5xx', () => { expect(administration.agendaAdministrationError({ status: 503 }, 'load')).toContain('cargar'); expect(administration.agendaAdministrationError({ status: 503 }, 'save')).toContain('guardar') })
  it('cargando y vacío tienen mensajes y nunca muestran un formulario incompleto', async () => {
    let result = await mount({ pending: true }); expect(result.host.querySelector('[role=status]')?.textContent).toBe('Cargando configuración…'); expect(result.host.querySelector('form')).toBeNull()
    result = await mount({ empty: true }); expect(result.host.textContent).toContain('No hay configuración disponible'); expect(result.host.querySelector('form')).toBeNull()
  })
  it('búsquedas, contadores y tabla preservan servicios, personal y reservas', async () => {
    const response = fixture(); response.recent.push({ id: 'b', status: 'active', date: '2026-10-05', time: '10:00', services: ['service'], personal: 'person' })
    const { host } = await mount({ response }); const search = host.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = 'ausente'; search.dispatchEvent(new Event('input')); await nextTick(); expect(host.textContent).toContain('No hay servicios que coincidan'); expect(host.querySelector('.catalog-count')?.textContent).toContain('0 de 1 seleccionados')
    expect(host.querySelector('tbody')?.textContent).toContain('Consulta'); expect(host.querySelector('tbody')?.textContent).toContain('Ana'); expect(host.querySelector('tbody')?.textContent).toContain('Activa')
  })
})

describe('Estado de la agenda colapsable, solo en memoria', () => {
  const pages = [{ id: 'pub', path: '/', publishedVersionId: 'version' }]
  it.each(['light', 'dark'] as const)('%s: completo colapsado, pill de éxito, controles y enlace al expandir', async theme => {
    document.documentElement.dataset.theme = theme
    const response = fixture(); response.settings.enabled = true
    const { host } = await mount({ response, pages, html: '{{agenda-component}}' })
    const toggle = host.querySelector<HTMLButtonElement>('.state-toggle')!
    const details = host.querySelector<HTMLElement>('#agenda-readiness-details')!
    expect(host.querySelector('.readiness .state-pill')?.textContent).toBe('Completado'); expect(host.querySelector('.readiness .state-pill svg')).not.toBeNull()
    expect(host.querySelector('.readiness .state-pill')?.classList.contains('is-complete')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(toggle.getAttribute('aria-controls')).toBe(details.id); expect(details.style.display).toBe('none')
    toggle.focus(); expect(document.activeElement).toBe(toggle); expect(toggle.type).toBe('button')
    // click es la activación nativa del botón, también al pulsar Enter/Espacio;
    // jsdom no implementa esa acción predeterminada de teclado.
    toggle.click(); await nextTick(); expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(details.style.display).not.toBe('none')
    expect(details.querySelectorAll('[data-ready=true]')).toHaveLength(6); expect(details.querySelector('a[target=_blank]')?.textContent).toBe('Ver mi agenda pública')
    const source = readFileSync(file, 'utf8'); expect(auditThemeSource(file, source)).toEqual([])
    const tokens = theme === 'dark' ? darkTokens : lightTokens
    expect(tokens['success-bg']).toBeTruthy(); expect(tokens['success-text']).toBeTruthy(); expect(tokens['warning-bg']).toBeTruthy(); expect(tokens['warning-text']).toBeTruthy()
    expect(source).toContain('background:rgb(var(--brand-success-bg))'); expect(source).toContain('color:rgb(var(--brand-success-text))')
    expect(source).toContain('background:rgb(var(--brand-warning-bg))'); expect(source).toContain('color:rgb(var(--brand-warning-text))')
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
  })
  it.each(['light', 'dark'] as const)('%s: pendientes expandidos, avance correcto y elección manual estable', async theme => {
    document.documentElement.dataset.theme = theme
    const { host } = await mount()
    expect(host.querySelector('.readiness .state-pill')?.textContent).toBe('4 de 6'); expect(host.querySelector('.readiness .state-pill svg')).not.toBeNull(); expect(host.querySelector('.readiness .state-pill')?.classList.contains('is-pending')).toBe(true)
    const toggle = host.querySelector<HTMLButtonElement>('.state-toggle')!; expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click(); await nextTick(); expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const search = host.querySelector<HTMLInputElement>('input[type=search]')!; search.value = 'Consulta'; search.dispatchEvent(new Event('input')); await nextTick()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const fresh = await mount(); expect(fresh.host.querySelector('.state-toggle')?.getAttribute('aria-expanded')).toBe('true')
  })
  it('al guardar el último requisito se colapsa sola y anuncia la transición', async () => {
    const { host, data, refresh, fetch } = await mount({ pages, html: '{{agenda-component}}' })
    expect(host.querySelector('.readiness .state-pill')?.textContent).toBe('5 de 6')
    refresh.mockImplementationOnce(async () => { data.value = { ...data.value!, settings: { ...data.value!.settings, enabled: true } } })
    const checkbox = host.querySelector<HTMLInputElement>('#agenda-enabled')!; checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); await nextTick()
    expect(host.querySelector('.state-toggle')?.getAttribute('aria-expanded')).toBe('true')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(fetch).toHaveBeenCalledWith('/api/agenda/site-settings', expect.objectContaining({ method: 'PUT' }))
    expect(host.querySelector('.readiness .state-pill')?.textContent).toBe('Completado'); expect(host.querySelector('.state-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('.readiness [role=status]')?.textContent).toContain('tarjeta contraída')
  })
  it('refrescar sin cambiar los requisitos conserva la expansión manual de una agenda completa', async () => {
    const response = fixture(); response.settings.enabled = true
    const { host, refresh } = await mount({ response, pages, html: '{{agenda-component}}' })
    const toggle = host.querySelector<HTMLButtonElement>('.state-toggle')!; toggle.click(); await nextTick()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    host.querySelector<HTMLButtonElement>('.header-refresh')!.click(); await settle()
    expect(refresh).toHaveBeenCalled(); expect(host.querySelector('.readiness .state-pill')?.textContent).toBe('Completado'); expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})


describe('Adiciones autorizadas: horario propio y acento personalizado', () => {
  it.each(['light', 'dark'] as const)('%s: sincroniza color, preview, AA y bloqueo de guardar', async theme => {
    document.documentElement.dataset.theme = theme
    const { host, fetch } = await mount()
    const custom = host.querySelector<HTMLInputElement>('input[type=radio][value=custom]')!
    custom.checked = true; custom.dispatchEvent(new Event('change')); await nextTick()
    const text = host.querySelector<HTMLInputElement>('input[placeholder="#RRGGBB"]')!
    text.value = '#AbC'; text.dispatchEvent(new Event('input')); await nextTick()
    expect(host.querySelector<HTMLInputElement>('input[type=color]')?.value).toBe('#aabbcc')
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('#aabbcc')
    expect(host.textContent).toContain('Aprobado AA')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(fetch).toHaveBeenLastCalledWith('/api/agenda/site-settings', expect.objectContaining({ body: expect.objectContaining({ settings: expect.objectContaining({ accent: 'custom', accentColor: '#aabbcc' }) }) }))
    const picker = host.querySelector<HTMLInputElement>('input[type=color]')!
    picker.value = '#abcdef'; picker.dispatchEvent(new Event('input')); await nextTick()
    expect(text.value).toBe('#abcdef')
    text.value = 'url(x)'; text.dispatchEvent(new Event('input')); await nextTick()
    expect(host.textContent).toContain('Insuficiente')
    expect(host.querySelector<HTMLButtonElement>('button.primary-button')?.disabled).toBe(true)
    fetch.mockClear(); host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(fetch).not.toHaveBeenCalled()
    const preset = host.querySelector<HTMLInputElement>('input[type=radio][value=primary]')!
    preset.checked = true; preset.dispatchEvent(new Event('change')); await nextTick()
    expect(host.querySelector<HTMLButtonElement>('button.primary-button')?.disabled).toBe(false)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(fetch).toHaveBeenCalledWith('/api/agenda/site-settings', expect.objectContaining({ body: expect.objectContaining({ settings: expect.objectContaining({ accent: 'primary' }) }) }))
  })
  it('admin sin horario crea únicamente el propio y conserva borrador', async () => {
    const response = { ...fixture(), ownStaff: { id: 'admin', administrator: true, scheduled: false } }
    const { host, fetch } = await mount({ response })
    const limit = host.querySelector<HTMLInputElement>('input[type=number]')!
    limit.value = '12'; limit.dispatchEvent(new Event('input')); await nextTick()
    const button = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Atiendo citas yo'))!
    expect(button).toBeDefined(); button.click(); await settle()
    expect(fetch).toHaveBeenCalledWith('/api/agenda/own-schedule', { method: 'POST', body: {} })
    expect(limit.value).toBe('12')
  })
  it('no muestra bootstrap a usuarios sin administración', async () => {
    const response = { ...fixture(), ownStaff: { id: 'person', administrator: false, scheduled: false } }
    const { host } = await mount({ response })
    expect(host.textContent).not.toContain('Atiendo citas yo')
  })
})
