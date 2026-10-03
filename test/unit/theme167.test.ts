// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, Suspense, unref, watch, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { compileVueComponent } from '../helpers/vueComponent'
import { auditThemeColors, auditThemeSource, migratedThemeFiles, themeColorExceptions } from '../../scripts/auditThemeColors'
import { lightTokens, darkTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight } from '../../utils/theme'
import { isSitesContrast, sitesContrastPairs, themeContrasts } from '../helpers/themeContrast'
import baseline from '../fixtures/themeBaseline167.json'
import nextBaseline from '../fixtures/themeBaseline168.json'
import originals from '../fixtures/themeSites167.json'
import protectedFiles from '../fixtures/themeSitesProtected167.json'

const routes = [
  'pages/sites/index.vue', 'pages/sites/templates.vue', 'pages/sites/trash.vue',
  ...['domains', 'forms', 'analytics', 'landing-pages', 'pages'].map(section => `pages/sites/${section}/index.vue`),
  'pages/sites/[siteId]/index.vue',
  ...['overview', 'analytics', 'domains', 'forms', 'landing-pages', 'pages', 'publications', 'settings'].map(section => `pages/sites/[siteId]/${section}/index.vue`)
]
const components = ['SitesAnalyticsSummary', 'SitesDomainManager', 'SitesFormManager', 'SitesPageManager']
const apps: App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
const timestamp = '2026-10-02T12:00:00Z'
const pages = ['published', 'draft', 'archived'].map((status, index) => ({ id: `p${index}`, siteId: 's', siteName: 'Sitio de prueba', siteSlug: 'prueba', title: `Página ${status}`, path: index ? `/ruta-${index}` : '/', status, kind: 'website', formCount: 1, updatedAt: timestamp }))
const site = { id: 's', name: 'Sitio de prueba', slug: 'prueba', status: 'published', locale: 'es-MX', pageCount: 3, formCount: 2, updatedAt: timestamp, pages }
const fields = [{ id: 'f1', name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: {} }, { id: 'f2', name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }]
const forms = [null, { entityId: 'e', entityName: 'Clientes', entitySlug: 'clientes', fieldMapping: { nombre: 'nombre' }, defaultValues: { activo: true }, valueMappings: {} }].map((connection, index) => ({ id: `form${index}`, name: `Contacto ${index}`, method: 'POST', action: '/', fields: [{ name: 'nombre', label: 'Nombre', type: 'text', required: true }], siteId: 's', siteName: site.name, pageId: 'p0', pageTitle: pages[0]!.title, pagePath: '/', updatedAt: timestamp, connection }))
const domains = ['pending', 'active', 'error'].map((status, index) => ({ id: `d${index}`, siteId: 's', siteName: site.name, hostname: `dominio-${index}.local`, status, isPrimary: index === 1, rootPageId: 'p0', rootPageTitle: pages[0]!.title, recordType: 'subdomain', providerConfigured: status === 'active', ownershipVerified: status === 'active', dnsVerified: status === 'active', lastCheckedAt: timestamp, dnsRecords: [{ type: 'CNAME', name: 'www', value: 'ejemplo.local', purpose: 'routing' }], providerData: status === 'error' ? { providerError: 'Error de prueba del proveedor' } : {} }))
const publications = ['published', 'superseded', 'draft'].map((status, index) => ({ id: `pub${index}`, pageId: 'p0', pageTitle: pages[0]!.title, pagePath: '/', version: index + 1, status, updatedAt: timestamp }))
function response(url: string, empty = false): unknown {
  if (url === '/api/sites') return { sites: empty ? [] : [site] }
  if (url.startsWith('/api/sites/pages')) return { pages: empty ? [] : pages }
  if (url.startsWith('/api/sites/domains')) return { domains: empty ? [] : domains }
  if (url.endsWith('/forms')) return { forms: empty ? [] : forms }
  if (url.endsWith('/publications')) return { publications: empty ? [] : publications }
  if (url === '/api/sites/s') return empty ? { ...site, pages: [] } : site
  if (url === '/api/entities?deleted=exclude') return { entities: [{ id: 'e', name: 'Clientes', slug: 'clientes', isActive: true }] }
  if (url === '/api/entities/clientes/fields') return { fields }
  throw new Error(`Petición no simulada: ${url}`)
}
interface MountOptions { empty?: boolean; pending?: boolean; error?: boolean; fetch?: ReturnType<typeof vi.fn>; props?: Record<string, unknown> }
async function mount(file: string, theme: 'light' | 'dark', options: MountOptions = {}) {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  document.body.dataset.contentTheme = theme
  const fetch = options.fetch ?? vi.fn(async (url: string) => response(url, options.empty))
  const refresh = vi.fn()
  const navigate = vi.fn()
  const meta = vi.fn()
  const toast = { success: vi.fn(), updated: vi.fn(), error: vi.fn() }
  const globals = { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount,
    definePageMeta: meta, useRequestHeaders: () => ({}), useRoute: () => ({ params: { siteId: 's' }, query: {} }),
    navigateTo: navigate, useToast: () => toast, useConfirm: () => ({ confirm: vi.fn(async () => true) }),
    usePlanLimit: () => ({ checkBeforeCreate: vi.fn(async () => true), handlePlanLimitError: vi.fn(async () => false) }),
    $fetch: fetch,
    useFetch: async (input: string | (() => string) | ReturnType<typeof computed>) => {
      const url = typeof input === 'function' ? input() : unref(input)
      return { data: ref(response(String(url), options.empty)), pending: ref(!!options.pending), error: ref(options.error ? new Error('Fallo simulado') : null), refresh }
    } }
  const component = compileVueComponent(file, {}, globals, { client: false, server: false, dev: false })
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, options.props ?? {}) }) })
  const link: Component = { setup(_, { slots, attrs }) { return () => h('a', attrs, slots.default?.()) } }
  const header: Component = { setup(_, { slots, attrs }) { return () => h('header', [h('h1', String(attrs.title)), ...Object.values(slots).flatMap(slot => slot?.() ?? [])]) } }
  app.component('NuxtLink', link); app.component('ListPageHeader', header)
  for (const name of components) app.component(name, compileVueComponent(`components/${name}.vue`, {}, globals, { client: false, server: false, dev: false }))
  const host = document.createElement('div'); document.body.append(host); app.mount(host); apps.push(app)
  await flush()
  expect(host.querySelector('.theme-light')).toBeNull()
  expect(document.documentElement.style.colorScheme).toBe(theme)
  return { host, fetch, refresh, navigate, meta, toast }
}
function click(element: Element | null | undefined) { expect(element).toBeTruthy(); element!.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
function input(element: HTMLInputElement | HTMLSelectElement, value: string, event = 'input') { element.value = value; element.dispatchEvent(new Event(event, { bubbles: true })) }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('contratos HU-167', () => {
  it('protege los 192 tokens previos y cada claro nuevo exacto, con CSS completo', () => {
    expect(Object.keys(baseline.light)).toHaveLength(192)
    for (const [theme, values] of Object.entries(baseline)) for (const [name, value] of Object.entries(values)) expect((theme === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens], `${theme}:${name}`).toBe(value)
    expect(Object.keys(nextBaseline.light).filter(name => !(name in baseline.light)).sort()).toEqual(Object.keys(originals).sort())
    const css = readFileSync('assets/css/theme.css', 'utf8')
    for (const [name, values] of Object.entries(originals)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(values[0]); expect(darkTokens[name as keyof typeof lightTokens]).toBe(values[1])
      for (const value of values) expect(css).toContain(`--brand-${name}: ${rgbChannels(value!)};`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(values[0]!)} !important;`)
    }
  })
  it('marca exactamente su alcance y conserva públicos y contenido del cliente tras HU-168', () => {
    expect(routes).toHaveLength(17)
    for (const file of routes) { expect(readFileSync(file, 'utf8'), file).toContain('darkReady: true'); expect(migratedThemeFiles).toContain(file) }
    expect(contentNeedsLight({ darkReady: true })).toBe(false)
    expect(contentNeedsLight({})).toBe(true)
    for (const [file, hash] of Object.entries(protectedFiles).filter(([file]) => file === 'utils/sitesEditorScript.ts' || file === 'server/utils/siteDomains.ts')) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash)
    const editor = readFileSync('pages/sites/[siteId]/pages/[pageId].vue', 'utf8')
    expect(editor).toContain('darkReady: true'); expect(editor).toContain('theme-light')
    expect(readFileSync('utils/sitesEditorScript.ts', 'utf8')).toContain(':root{color-scheme:light!important}')
    expect(readFileSync('server/utils/siteDomains.ts', 'utf8')).toContain('<meta name="color-scheme" content="light">')
  })
  it('cierra la guardia sin excepciones nuevas ni archivos enteros excluidos', () => {
    expect(auditThemeColors()).toEqual([])
    for (const name of components) expect(migratedThemeFiles).toContain(`components/${name}.vue`)
    for (const file of [...routes, ...components.map(name => `components/${name}.vue`)]) {
      expect(themeColorExceptions[file]).toBeUndefined()
      expect(auditThemeSource(file, '<span class="hover:bg-white text-slate-500" style="box-shadow:0 0 1px #fff"/>')).toHaveLength(3)
    }
  })
  it('exige AA a todos los pares nuevos oscuros sin cambiar valores anteriores', () => {
    const pairs = themeContrasts().filter(isSitesContrast)
    expect(pairs.filter(pair => pair.theme === 'dark')).toHaveLength(sitesContrastPairs.length)
    for (const pair of pairs.filter(pair => pair.theme === 'dark')) expect(pair.ratio, pair.id).toBeGreaterThanOrEqual(pair.minimum)
    // La lista y razones de los claros heredados se congelan tras su medición inicial.
    expect(pairs.filter(pair => pair.theme === 'light' && pair.ratio < pair.minimum).map(pair => [pair.id, Number(pair.ratio.toFixed(3)), pair.minimum])).toEqual(lightDeficits)
  })
})

// Se completa con las mediciones del primer análisis, sin corregir el claro aprobado.
const lightDeficits: [string, number, number][] = [
  ['light:sites-muted/surface', 2.659, 4.5], ['light:sites-muted/bg', 2.493, 4.5],
  ['light:sites-muted/designer-section-bg', 2.540, 4.5], ['light:sites-muted/dashboard-soft', 2.541, 4.5],
  ['light:sites-muted/sites-row-hover', 2.557, 4.5], ['light:sites-icon/surface', 2.990, 4.5],
  ['light:sites-icon/bg', 2.803, 4.5], ['light:sites-icon/kanban-divider', 2.634, 3],
  ['light:primary-fg/sites-primary-hover', 2.820, 4.5], ['light:sites-muted/sites-choice-bg', 2.512, 4.5],
  ['light:sites-choice-border/surface', 1.285, 3], ['light:blue/blue-bg', 3.294, 4.5],
  ['light:warning-text/surface', 3.941, 4.5]
]

describe.each(['light', 'dark'] as const)('montajes reales Sites sin red, %s', theme => {
  it.each(routes)('monta la página %s y sus gestores con el tema vigente', async file => {
    const { host, meta, navigate } = await mount(file, theme)
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ darkReady: true }))
    if (file === 'pages/sites/[siteId]/index.vue') expect(navigate).toHaveBeenCalledWith('/sites/s/overview', { replace: true })
    else expect(host.textContent?.trim().length).toBeGreaterThan(0)
  })
  it.each(components)('monta %s vacío/cargando/error sin peticiones reales', async name => {
    const file = `components/${name}.vue`
    const empty = await mount(file, theme, { empty: true }); expect(empty.host.textContent).toMatch(/No hay|no hay|No se detectaron|Aún no hay/)
    const loading = await mount(file, theme, { pending: true }); expect(loading.host.textContent).toContain('Cargando')
    const error = await mount(file, theme, { error: true })
    if (name !== 'SitesAnalyticsSummary') expect(error.host.textContent).toMatch(/No se pud|No se pudo/)
    // Analítica no tiene estado de error en su implementación original.
  })
  it('conserva el POST de crear sitio, slug sugerido y navegación', async () => {
    const fetch = vi.fn(async () => ({ ...site, id: 'nuevo' }))
    const { host, navigate, refresh } = await mount('pages/sites/index.vue', theme, { fetch })
    click(host.querySelector('.sites-primary')); await flush()
    const controls = host.querySelectorAll<HTMLInputElement>('.site-modal input')
    input(controls[0]!, 'Mi empresa'); controls[0]!.dispatchEvent(new Event('blur')); await nextTick()
    expect(controls[1]!.value).toBe('mi-empresa')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites', { method: 'POST', body: expect.objectContaining({ name: 'Mi empresa', slug: 'mi-empresa', locale: 'es-MX' }) })
    expect(refresh).toHaveBeenCalled(); expect(navigate).toHaveBeenCalledWith('/sites/nuevo/overview'); expect(host.querySelector('.site-modal')).toBeNull()
  })
  it.each(['website', 'landing'])('mantiene filtros y creación de %s', async kind => {
    const fetch = vi.fn(async () => ({ id: 'nueva' }))
    const { host, navigate } = await mount('components/SitesPageManager.vue', theme, { props: { kind }, fetch })
    expect(host.querySelectorAll('.content-data')).toHaveLength(3)
    click(host.querySelectorAll('.manager-tabs button')[1]); await nextTick(); expect(host.querySelectorAll('.content-data')).toHaveLength(1)
    click(host.querySelector('.primary-button')); await flush()
    const controls = host.querySelectorAll<HTMLInputElement>('.create-modal input')
    input(controls[0]!, 'Nueva oferta'); controls[0]!.dispatchEvent(new Event('blur')); await nextTick()
    expect(controls[1]!.value).toBe(kind === 'landing' ? '/landing/nueva-oferta' : '/nueva-oferta')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/s/pages', { method: 'POST', body: { title: 'Nueva oferta', path: controls[1]!.value, kind } })
    expect(navigate).toHaveBeenCalledWith('/sites/s/pages/nueva')
  })
  it('muestra publicado/borrador/archivado y conserva la tabla de versiones', async () => {
    const { host } = await mount('pages/sites/index.vue', theme)
    expect(host.querySelector('.is-published')?.textContent).toBe('Publicado')
    const versions = await mount('pages/sites/[siteId]/publications/index.vue', theme)
    for (const label of ['Publicada', 'Anterior', 'Borrador']) expect(versions.host.textContent).toContain(label)
    expect(versions.host.querySelectorAll('a[aria-label="Abrir versión"]')).toHaveLength(3)
  })
  it('distingue los estados de dominio y la verificación activa por texto', async () => {
    let finish: ((value: unknown) => void) | undefined
    const fetch = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const { host, refresh } = await mount('components/SitesDomainManager.vue', theme, { fetch })
    expect(host.textContent).toContain('Esperando DNS'); expect(host.textContent).toContain('Activo'); expect(host.querySelector('.status.failed')?.textContent).toContain('Error de dominio')
    click(host.querySelector('button[title="Verificar DNS"]')); await nextTick()
    expect(host.textContent).toContain('Verificando…'); expect(host.querySelector<HTMLButtonElement>('button[title="Verificar DNS"]')?.disabled).toBe(true)
    finish!({ status: 'active' }); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/domains/d0/verify', { method: 'POST' }); expect(refresh).toHaveBeenCalled(); expect(host.textContent).not.toContain('Verificando…')
  })
  it('el diálogo de dominio teletransportado hereda oscuro y conserva el POST', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/sites/s' ? site : {})
    const { host, refresh } = await mount('components/SitesDomainManager.vue', theme, { fetch })
    click(host.querySelector('.primary')); await flush()
    const dialog = document.body.querySelector('.modal')!
    expect(dialog.closest('.theme-light')).toBeNull(); expect(dialog.closest('[data-theme-shell]')).toBeNull()
    input(dialog.querySelector<HTMLInputElement>('input')!, 'www.miempresa.local')
    dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/domains', { method: 'POST', body: { siteId: 's', hostname: 'www.miempresa.local', rootPageId: 'p0' } })
    expect(refresh).toHaveBeenCalled(); expect(document.body.querySelector('.modal')).toBeNull()
  })
  it('conserva filtros de formulario, campos, valores automáticos y conexión', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/fields') ? { fields } : {})
    const { host, refresh } = await mount('components/SitesFormManager.vue', theme, { fetch })
    expect(host.querySelectorAll('.form-data')).toHaveLength(2)
    click(host.querySelectorAll('.forms-tabs button')[1]); await nextTick(); expect(host.querySelectorAll('.form-data')).toHaveLength(1)
    click(host.querySelector('.connection-active')); await flush()
    expect(host.querySelector('.connection-modal')?.textContent).toContain('Mapeo de campos')
    expect(host.querySelector('.connection-modal')?.textContent).toContain('Valores automáticos')
    const select = host.querySelector<HTMLSelectElement>('.default-row select')!; expect(select.value).toBe('true')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/s/forms/connection', { method: 'POST', body: { pageId: 'p0', formKey: 'form1', entityId: 'e', fieldMapping: { nombre: 'nombre' }, defaultValues: { activo: true }, valueMappings: {} } })
    expect(refresh).toHaveBeenCalled(); expect(host.querySelector('.connection-modal')).toBeNull()
  })
  it('conserva errores de guardado y estados disabled en el formulario de conexión', async () => {
    const fetch = vi.fn(async (url: string) => { if (url.endsWith('/fields')) return { fields }; throw { data: { statusMessage: 'Error de prueba al guardar' } } })
    const { host } = await mount('components/SitesFormManager.vue', theme, { fetch })
    click(host.querySelector('.connection-pending')); await flush()
    expect(host.querySelector<HTMLButtonElement>('.connection-modal .primary-button')?.disabled).toBe(true)
    input(host.querySelector<HTMLSelectElement>('.modal-body>label select')!, 'e', 'change'); await flush()
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(host.querySelector('.form-error')?.textContent).toContain('Error de prueba al guardar')
  })
  it('guarda ajustes sin alterar idioma ni dirección del sitio', async () => {
    const fetch = vi.fn(async () => ({}))
    const { host, refresh } = await mount('pages/sites/[siteId]/settings/index.vue', theme, { fetch })
    input(host.querySelector('input')!, 'Identidad nueva')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/s', { method: 'PUT', body: expect.objectContaining({ name: 'Identidad nueva', slug: 'prueba', locale: 'es-MX' }) })
    expect(refresh).toHaveBeenCalled(); expect(host.querySelector('.text-brand-sites-saved')?.textContent).toContain('Cambios guardados')
  })
})
