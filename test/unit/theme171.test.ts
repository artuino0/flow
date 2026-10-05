// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, Suspense, watch, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from '@vue/compiler-sfc'
import { compileVueComponent } from '../helpers/vueComponent'
import { darkTokens, lightTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight } from '../../utils/theme'
import { auditThemeColors, auditThemeSource, migratedThemeFiles, themeColorExceptions } from '../../scripts/auditThemeColors'
import { billingContrastPairs, isBillingContrast, themeContrasts } from '../helpers/themeContrast'
import * as catalogos from '../../utils/cfdiCatalogos'
import * as platformForm from '../../utils/platformPlanForm'
import * as planConcepts from '../../utils/planConcepts'
import * as chattito from '../../utils/chattito'
import * as onboarding from '../../utils/onboardingTours'
import baseline from '../fixtures/themeBaseline171.json'
import nextBaseline from '../fixtures/themeBaseline172.json'
import colors from '../fixtures/themeBilling171.json'
import deficits from '../fixtures/themeBillingDeficits171.json'
import paper from '../fixtures/themeInvoicePaper171.json'

const apps: App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
const modes = ['light', 'dark'] as const
const series = [{ id: 's', serie: 'A', tipoComprobante: 'I', lugarExpedicion: '20110', nextFolio: 2, estado: 'activa' }]
const plan = { id: 'p', code: 'agenda', name: 'Agenda', description: 'Plan de prueba', isActive: true, isPublic: true, sortOrder: 1, monthlyPriceCents: 10000, annualPriceCents: 100000, limits: { users: 5, modules: 3, aiCredits: 20 }, blockedBy: [], stripeMonthlyPriceId: null, stripeAnnualPriceId: null }
function detail(estado = 'timbrada', tipo = 'I') {
  return { documento: { id: 'd', tipo, estado, serieId: 's', folio: estado === 'borrador' ? null : 1, moneda: 'MXN', subtotal: '100', descuento: '0', total: '116', receptorNombre: 'Cliente QA', receptorRfc: 'AAA010101AAA', receptorCodigoPostal: '20110', receptorRegimenFiscal: '601', receptorCorreo: 'qa@ejemplo.invalid', uuidFiscal: estado === 'borrador' ? null : 'uuid-qa', fechaEmision: '2026-10-03T12:00:00Z', createdAt: '2026-10-03T12:00:00Z', usoCfdi: 'G03', exportacion: '01', hasXml: false, mensajePac: 'Error fiscal simulado', impuestos: { traslados: [{ importe: '16', tasaOCuota: '.16' }] } }, serie: series[0], conceptos: [{ orden: 0, descripcion: 'Servicio QA', claveProdServ: '01010101', claveUnidad: 'H87', cantidad: 1, valorUnitario: '100', descuento: 0, importe: '100' }], pagos: [], relacionado: null, relaciones: [], events: ['intento_timbrado', 'timbrado_ok', 'error_pac', 'cancelacion_solicitada', 'cancelacion_confirmada'].map((tipo, id) => ({ id, tipo, createdAt: '2026-10-03T12:00:00Z', detalle: tipo === 'error_pac' ? { message: 'Error simulado' } : {} })) }
}
function setTheme(mode: 'light' | 'dark') {
  document.documentElement.dataset.theme = mode
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.style.colorScheme = mode
  document.body.dataset.contentTheme = 'inherit'
}
type State = { estado?: string; tipo?: string; hasXml?: boolean; empty?: boolean; error?: boolean; pending?: boolean; blocked?: boolean; query?: Record<string, string>; percent?: number; fetch?: ReturnType<typeof vi.fn> }
async function mount(file: string, mode: 'light' | 'dark', state: State = {}) {
  setTheme(mode)
  const meta = vi.fn(), push = vi.fn(), toast = { success: vi.fn(), updated: vi.fn(), error: vi.fn() }
  const fetch = state.fetch ?? vi.fn(async (url: string, options?: { method?: string }) => {
    if (state.error && url.startsWith('/api/facturacion/documents')) throw { data: { statusMessage: 'Error simulado' } }
    if (url === '/api/facturacion/series') return series
    if (url === '/api/facturacion/relacionables') return []
    if (url === '/api/facturacion/documents') return { rows: state.empty ? [] : ['borrador', 'timbrando', 'timbrada', 'cancelada', 'error'].map((estado, id) => ({ ...detail(estado).documento, id, serie: 'A' })), total: state.empty ? 0 : 5 }
    if (url === '/api/facturacion/documents/d' && !options?.method) return detail(state.estado, state.tipo)
    if (url.startsWith('/api/facturacion/documents/d/')) return { para: 'qa@ejemplo.invalid' }
    if (url === '/api/billing/checkout') throw { data: { statusMessage: 'Checkout simulado no disponible' } }
    throw new Error(`Petición no simulada: ${url}`)
  })
  const globals = { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount,
    useState: <T>(_key: string, init: () => T) => ref(init()),
    definePageMeta: meta, useRoute: () => ({ params: { id: 'd' }, query: { preview: '1', tipo: state.tipo ?? 'I', ...state.query }, meta: {} }),
    useRouter: () => ({ push }), useToast: () => toast, useConfirm: () => ({ confirm: vi.fn(async () => false) }), $fetch: fetch,
    useRequestHeaders: () => ({}), useHead: vi.fn(), onBeforeRouteLeave: vi.fn(),
    useIsAdmin: () => ({ data: ref(true) }),
    useBillingOverview: () => ({ data: ref({ stripeConfigured: false, subscription: { plan, status: 'active', billingInterval: 'month', currentPeriodEnd: null, cancelAtPeriodEnd: false }, usage: [{ resourceKey: 'users', label: 'Usuarios', used: 5, limit: 5, percent: state.percent ?? 100 }], invoices: [], usageHistory: [] }), pending: ref(!!state.pending), error: ref(state.error ? new Error('Error simulado') : null), refresh: vi.fn() }),
    useDesignerPlanUsage: () => ({ data: ref({ plan: 'Agenda', usage: [{ concept: 'users', label: 'Usuarios', used: 5, limit: 5, percent: state.percent ?? 100 }] }), refresh: vi.fn() }),
    useFetch: (url: string) => {
      let data: unknown
      if (url === '/api/billing/plans') data = { plans: state.empty ? [] : [{ ...plan, blockedBy: state.blocked ? ['users'] : [] }] }
      else if (url === '/api/platform/plans') data = { plans: state.empty ? [] : [plan], organizations: [], overrides: [] }
      else if (url === '/api/facturacion/documents/d') { const invoice = detail(state.estado, state.tipo); invoice.documento.hasXml = !!state.hasXml; data = invoice }
      else if (url === '/api/tenant/branding') data = { name: 'Empresa QA', fiscalData: {}, hasLogo: false, email: null, phone: null }
      else throw new Error(`useFetch no simulado: ${url}`)
      return { data: ref(data), pending: ref(!!state.pending), error: ref(state.error ? new Error('Error simulado') : null), status: ref(state.pending ? 'pending' : 'success'), refresh: vi.fn() }
    }
  }
  const imports = { '~/utils/cfdiCatalogos': catalogos, '~/utils/platformPlanForm': platformForm, '~/utils/planConcepts': planConcepts }
  const component = compileVueComponent(file, imports, globals)
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component) }) })
  const link: Component = { setup(_, { attrs, slots }) { return () => h('a', { ...attrs, href: attrs.to }, slots.default?.()) } }
  const header: Component = { setup(_, { slots }) { return () => h('header', [slots.actions?.(), slots['toolbar-left']?.()]) } }
  app.component('NuxtLink', link); app.component('ListPageHeader', header)
  app.component('AgentUsageTable', { render: () => h('div') })
  const host = document.createElement('div'); document.body.append(host)
  if (file.startsWith('pages/facturacion-print/')) host.classList.add('theme-light')
  app.mount(host); apps.push(app); await flush()
  return { host, fetch, meta, push, toast }
}
async function click(host: Element, label: string) {
  const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.includes(label))
  expect(target, label).toBeTruthy(); target!.click(); await flush()
}
function addStyle(css: string) { const el = document.createElement('style'); el.dataset.theme171 = ''; el.textContent = css; document.head.append(el) }
afterEach(() => {
  apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''
  document.querySelectorAll('style[data-theme171]').forEach(el => el.remove())
  Reflect.deleteProperty(document, 'fonts'); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('contratos HU-171', () => {
  it('preserva los 273 tokens anteriores y los nuevos claros originales', () => {
    expect(Object.keys(baseline.light)).toHaveLength(273)
    for (const [mode, tokens] of Object.entries(baseline)) for (const [name, value] of Object.entries(tokens)) expect((mode === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens], `${mode}:${name}`).toBe(value)
    expect(Object.keys(nextBaseline.light).filter(name => !(name in baseline.light)).sort()).toEqual(Object.keys(colors).sort())
    const css = readFileSync('assets/css/theme.css', 'utf8')
    for (const [name, values] of Object.entries(colors)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(values[0]); expect(darkTokens[name as keyof typeof lightTokens]).toBe(values[1])
      for (const value of values) expect(css).toContain(`--brand-${name}: ${rgbChannels(value!)};`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(values[0]!)} !important;`)
    }
  })
  it('congela los déficits claros reales y exige AA a cada par oscuro nuevo', () => {
    const results = themeContrasts().filter(isBillingContrast)
    expect(results.filter(v => v.theme === 'dark')).toHaveLength(billingContrastPairs.length)
    for (const v of results.filter(v => v.theme === 'dark')) expect(v.ratio, v.id).toBeGreaterThanOrEqual(v.minimum)
    expect(results.filter(v => v.theme === 'light' && v.ratio < v.minimum).map(v => [v.id, Number(v.ratio.toFixed(3)), v.minimum])).toEqual(deficits)
  })
  it('cubre las fuentes nuevas con guardia cerrada y mantiene las fuentes impresas intactas', () => {
    expect(auditThemeColors()).toEqual([])
    for (const file of ['pages/facturacion/index.vue', 'pages/facturacion/nuevo.vue', 'pages/facturacion/[id].vue', 'pages/elegir-plan.vue', 'utils/cfdiCatalogos.ts']) {
      expect(migratedThemeFiles).toContain(file)
      expect(auditThemeSource(file, '<p class="bg-white text-slate-500" style="color:#fff"/>')).toHaveLength(3)
    }
    for (const [file, sha] of Object.entries(paper)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(sha)
    const printFile = 'pages/facturacion-print/[id].vue'
    expect(migratedThemeFiles).toContain(printFile)
    for (const literal of Object.keys(themeColorExceptions[printFile]!)) expect(auditThemeSource(printFile, readFileSync(printFile, 'utf8') + `\n<p style="color:${literal}"/>`)).toHaveLength(1)
    expect(readFileSync('pages/facturacion-print/[id].vue', 'utf8')).not.toContain('darkReady: true')
  })
  it('darkReady permite elegir plan y acceso sin layout y conserva impresión clara', () => {
    expect(contentNeedsLight({ layout: false, darkReady: true })).toBe(false)
    expect(contentNeedsLight({ layout: false })).toBe(true)
    for (const file of ['pages/login.vue', 'pages/registro.vue']) expect(readFileSync(file, 'utf8')).toContain('darkReady: true')
    expect(readFileSync('pages/facturacion-print/[id].vue', 'utf8')).not.toContain('darkReady: true')
  })
  it.each(modes)('el app real aplica el aislamiento según metadata en %s', async mode => {
    setTheme(mode)
    const route = reactive({ meta: { layout: false, darkReady: true } })
    const comp = compileVueComponent('app.vue', { '~/utils/chattito': chattito, '~/utils/onboardingTours': onboarding, '~/utils/theme': { contentNeedsLight } }, {
      ref, computed, watch, onMounted, onBeforeUnmount, useRoute: () => route, useHead: vi.fn(),
      useTheme: () => ({ initialize: vi.fn(), dispose: vi.fn() }), useAuth: () => ({ user: ref(null) }), useIsAdmin: () => ({ data: ref(false) }),
      useChattitoPanel: () => ({ panel: reactive({ open: false, width: 380, resizing: false }), reset: vi.fn() }), useOnboarding: () => ({ reset: vi.fn() })
    }, { client: false, server: true, dev: false })
    const app = createApp(comp), host = document.createElement('div'); document.body.append(host)
    const slot: Component = { setup(_, { slots }) { return () => h('div', slots.default?.()) } }
    app.component('NuxtLayout', slot); app.component('NuxtPage', slot); app.component('NuxtLoadingIndicator', slot)
    app.mount(host); apps.push(app); await flush()
    expect(host.querySelector('.chattito-app-content')?.classList.contains('theme-light')).toBe(false)
    route.meta.darkReady = false; await flush()
    expect(host.querySelector('.chattito-app-content')?.classList.contains('theme-light')).toBe(true)
  })
})

describe.each(modes)('facturación y planes, %s', mode => {
  it('lista todos los estados con texto; abre series y conserva datos al alternar tema', async () => {
    const { host, meta, fetch } = await mount('pages/facturacion/index.vue', mode)
    expect(meta).toHaveBeenCalledWith({ layout: 'default', darkReady: true })
    for (const label of ['Borrador', 'Timbrando…', 'Timbrada', 'Cancelada', 'Error de timbrado']) expect(host.textContent).toContain(label)
    await click(host, 'Series'); expect(host.textContent).toContain('Series fiscales')
    const before = host.innerHTML, calls = fetch.mock.calls.length
    setTheme(mode === 'light' ? 'dark' : 'light'); await flush()
    expect(host.innerHTML).toBe(before); expect(fetch).toHaveBeenCalledTimes(calls)
  })
  it.each(['borrador', 'timbrada', 'cancelada', 'error', 'timbrando'])('detalle %s, importes y línea fiscal textual', async estado => {
    const { host } = await mount('pages/facturacion/[id].vue', mode, { estado })
    expect(host.querySelector('.cfdi-status')?.textContent).toBe(catalogos.ESTADOS_CFDI[estado]!.label)
    expect(host.querySelector('.cfdi-summary-total')?.textContent).toContain('$116.00')
    expect(host.textContent).toContain('Cancelación solicitada'); expect(host.textContent).toContain('Error del PAC')
    const before = host.innerHTML; setTheme(mode === 'light' ? 'dark' : 'light'); await flush(); expect(host.innerHTML).toBe(before)
  })
  it('abre cancelación destructiva y envía motivo/sustituto únicamente al mock', async () => {
    const { host, fetch } = await mount('pages/facturacion/[id].vue', mode)
    await click(host, 'Cancelar ante el SAT')
    const dialog = host.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('irreversible')
    expect(dialog.querySelector('button:last-child')?.classList.contains('text-brand-error-fg')).toBe(true)
    const select = dialog.querySelector('select')!; select.value = '01'; select.dispatchEvent(new Event('change', { bubbles: true })); await flush()
    const input = dialog.querySelector('input')!; input.value = 'uuid-sustituto'; input.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    await click(dialog, 'Cancelar CFDI')
    expect(fetch).toHaveBeenCalledWith('/api/facturacion/documents/d/cancelar', { method: 'POST', body: { motivo: '01', folioSustitucion: 'uuid-sustituto' } })
  })
  it('captura real: conceptos, totales, selección SAT y validación de borrador', async () => {
    const { host, toast } = await mount('pages/facturacion/nuevo.vue', mode)
    expect(host.textContent).toContain('Receptor'); expect(host.querySelectorAll('select option').length).toBeGreaterThan(40)
    await click(host, 'Agregar concepto'); expect(host.querySelectorAll('.concept-row')).toHaveLength(2)
    const input = host.querySelector<HTMLInputElement>('.concept-row input[type="number"]')!; input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    await click(host, 'Guardar borrador')
    expect(host.querySelector('.invoice-error')?.textContent).toBe('El receptor necesita nombre.')
    expect(toast.error).not.toHaveBeenCalled()
    expect(host.querySelector('.invoice-summary .total')?.textContent).toContain('$0.00')
  })
  it('captura complemento P y nota de crédito E mantienen sus formularios', async () => {
    const complement = await mount('pages/facturacion/nuevo.vue', mode, { tipo: 'P' })
    expect(complement.host.textContent).toContain('Cobro aplicado'); expect(complement.host.textContent).toContain('Forma de pago (SAT)')
    const credit = await mount('pages/facturacion/nuevo.vue', mode, { tipo: 'E' })
    expect(credit.host.textContent).toContain('Factura relacionada')
  })
  it('guarda el borrador editado conservando el payload fiscal', async () => {
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/facturacion/series') return series
      if (url === '/api/facturacion/documents/d') return options?.method ? {} : detail('borrador')
      throw new Error(`Petición no simulada: ${url}`)
    })
    const { host, push } = await mount('pages/facturacion/nuevo.vue', mode, { query: { id: 'd' }, fetch })
    await click(host, 'Guardar borrador')
    expect(fetch).toHaveBeenCalledWith('/api/facturacion/documents/d', { method: 'PUT', body: expect.objectContaining({ receptor: { rfc: 'AAA010101AAA', nombre: 'Cliente QA', codigoPostal: '20110', regimenFiscal: '601', correo: 'qa@ejemplo.invalid' }, usoCfdi: 'G03', moneda: 'MXN', conceptos: [{ descripcion: 'Servicio QA', claveProdServ: '01010101', claveUnidad: 'H87', cantidad: 1, valorUnitario: 100, descuento: 0, traslado: null, retencion: null }] }) })
    expect(push).toHaveBeenCalledWith('/facturacion/d')
  })
  it('muestra carga de documentos antes de resolver la respuesta local', async () => {
    let resolveRows!: (value: { rows: unknown[]; total: number }) => void
    const response = new Promise(resolve => { resolveRows = resolve })
    const fetch = vi.fn((url: string) => {
      if (url === '/api/facturacion/series') return Promise.resolve(series)
      if (url === '/api/facturacion/documents') return response
      throw new Error(`Petición no simulada: ${url}`)
    })
    const { host } = await mount('pages/facturacion/index.vue', mode, { fetch })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Cargando documentos…')
    resolveRows({ rows: [], total: 0 }); await flush()
    expect(host.textContent).toContain('Todavía no hay documentos')
  })
  it('elegir plan cambia mensual/anual y conserva el error de checkout simulado', async () => {
    const { host, meta, fetch } = await mount('pages/elegir-plan.vue', mode)
    expect(meta).toHaveBeenCalledWith({ layout: false, darkReady: true })
    expect(host.textContent).toContain('$100'); await click(host, 'Anual'); expect(host.textContent).toContain('$1,000')
    await click(host, 'Comenzar prueba'); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Checkout simulado no disponible')
    expect(fetch).toHaveBeenCalledWith('/api/billing/checkout', { method: 'POST', body: { planCode: 'agenda', interval: 'year' } })
  })
  it('plan bloqueado, checkout cancelado y fallo de carga tienen texto', async () => {
    const blocked = await mount('pages/elegir-plan.vue', mode, { blocked: true, query: { canceled: '1' } })
    expect(blocked.host.textContent).toContain('Tu uso actual supera'); expect(blocked.host.querySelector<HTMLButtonElement>('article button')?.disabled).toBe(true)
    expect(blocked.host.querySelector('[role="status"]')?.textContent).toContain('No se completó Checkout')
    const failed = await mount('pages/elegir-plan.vue', mode, { error: true, empty: true })
    expect(failed.host.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar')
  })
  it('lista vacía y errores en listado/detalle', async () => {
    const empty = await mount('pages/facturacion/index.vue', mode, { empty: true }); expect(empty.host.textContent).toContain('Todavía no hay documentos')
    const failed = await mount('pages/facturacion/index.vue', mode, { error: true }); expect(failed.host.querySelector('[role="alert"]')?.textContent).toBe('Error simulado')
    const failedDetail = await mount('pages/facturacion/[id].vue', mode, { error: true }); expect(failedDetail.host.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar la factura')
  })
  it.each([80, 100])('resumen de Ajustes con consumo %s%% y plataforma ya migrada', async percent => {
    const summary = await mount('components/SettingsBillingSummary.vue', mode, { percent })
    expect(summary.host.textContent).toContain('Agenda'); expect(summary.host.textContent).toContain('Usuarios')
    expect(summary.host.querySelector('.theme-light')).toBeNull()
    const platform = await mount('pages/platform/plans.vue', mode)
    expect(platform.meta).toHaveBeenCalledWith({ fullBleed: true, darkReady: true }); expect(platform.host.textContent).toContain('Agenda')
  })
})

describe('factura impresa siempre clara', () => {
  it('QR y sellos del XML local se conservan exactamente al alternar tema', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    const xml = '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Total="116.00" NoCertificado="certificado-local"><cfdi:Emisor Rfc="AAA010101AAA"/><cfdi:Receptor Rfc="BBB010101BBB"/><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="00000000-0000-0000-0000-000000000001" SelloCFD="sello-local-12345678" SelloSAT="sello-sat-local" NoCertificadoSAT="certificado-sat-local" FechaTimbrado="2026-10-03T12:00:00Z"/></cfdi:Complemento></cfdi:Comprobante>'
    const network = vi.fn(async () => ({ ok: true, text: async () => xml })); vi.stubGlobal('fetch', network)
    addStyle(readFileSync('assets/css/theme.css', 'utf8'))
    addStyle(parse(readFileSync('pages/facturacion-print/[id].vue', 'utf8')).descriptor.styles[0]!.content)
    const { host } = await mount('pages/facturacion-print/[id].vue', 'light', { hasXml: true })
    await vi.waitFor(() => expect(host.querySelector<HTMLImageElement>('.qr-column img')?.src).toMatch(/^data:image\/png;base64,/))
    expect(host.textContent).toContain('sello-local-12345678'); expect(host.textContent).toContain('sello-sat-local')
    const qr = host.querySelector<HTMLImageElement>('.qr-column img')!, before = host.innerHTML, src = qr.src
    setTheme('dark'); await flush()
    expect(host.innerHTML).toBe(before); expect(qr.src).toBe(src)
    expect(getComputedStyle(qr).backgroundColor).toBe('rgb(255, 255, 255)')
    expect(network).toHaveBeenCalledExactlyOnceWith('/api/facturacion/documents/d/xml', { credentials: 'same-origin' })
  })
  it.each(['timbrada', 'cancelada', 'error', 'borrador'])('DOM y estilos invariables para %s al alternar tema', async estado => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    const network = vi.fn(() => { throw new Error('Red no autorizada') }); vi.stubGlobal('fetch', network)
    addStyle(readFileSync('assets/css/theme.css', 'utf8'))
    addStyle(parse(readFileSync('pages/facturacion-print/[id].vue', 'utf8')).descriptor.styles[0]!.content)
    const { host } = await mount('pages/facturacion-print/[id].vue', 'light', { estado })
    const invoice = host.querySelector('.invoice-paper')!
    const snapshot = () => ({ html: invoice.outerHTML, styles: [...host.querySelectorAll('*')].map(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.borderColor, s.fontSize, s.padding, s.width, s.minHeight].map(String) }), scheme: String(getComputedStyle(host).colorScheme) })
    const before = snapshot()
    expect(getComputedStyle(invoice).backgroundColor).toBe('rgb(255, 255, 255)')
    expect(before.scheme).toBe('light'); expect(getComputedStyle(invoice).width).toBe('816px')
    setTheme('dark'); await flush(); const after = snapshot(); expect(after).toEqual(before)
    expect(createHash('sha256').update(JSON.stringify(after)).digest('hex')).toBe(createHash('sha256').update(JSON.stringify(before)).digest('hex'))
    expect(network).not.toHaveBeenCalled()
  })
})
