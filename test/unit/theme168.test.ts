// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, Suspense, unref, watch, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import * as cm from 'codemirror'
import * as state from '@codemirror/state'
import * as view from '@codemirror/view'
import * as commands from '@codemirror/commands'
import * as htmlLanguage from '@codemirror/lang-html'
import * as cssLanguage from '@codemirror/lang-css'
import * as jsLanguage from '@codemirror/lang-javascript'
import { syntaxTree } from '@codemirror/language'
import { setDiagnostics } from '@codemirror/lint'
import { openSearchPanel } from '@codemirror/search'
import { startCompletion } from '@codemirror/autocomplete'
import { compileVueComponent } from '../helpers/vueComponent'
import * as codeTheme from '../../utils/sitesCodeTheme'
import { lightTokens, darkTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight } from '../../utils/theme'
import { buildPreviewDocument, joinSiteScript, splitSiteScript } from '../../utils/sitesEditorScript'
import { auditThemeColors, auditThemeSource, migratedThemeFiles, themeColorExceptions } from '../../scripts/auditThemeColors'
import { editorContrastPairs, isEditorContrast, themeContrasts } from '../helpers/themeContrast'
import baseline from '../fixtures/themeBaseline168.json'
import nextBaseline from '../fixtures/themeBaseline170.json'
import colors from '../fixtures/themeEditor168.json'
import deficits from '../fixtures/themeEditorDeficits168.json'

const apps: App[] = []
const files = ['pages/sites/[siteId]/pages/[pageId].vue', 'components/SitesCodeEditor.client.vue', 'components/SitesEditorForms.vue', 'components/SitesAssetLibrary.vue', 'utils/sitesCodeTheme.ts']
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 25)); await nextTick() }
const imports = { codemirror: cm, '@codemirror/state': state, '@codemirror/view': view, '@codemirror/commands': commands, '@codemirror/lang-html': htmlLanguage, '@codemirror/lang-css': cssLanguage, '@codemirror/lang-javascript': jsLanguage, '~/utils/sitesCodeTheme': codeTheme, '~/utils/sitesEditorScript': { buildPreviewDocument, joinSiteScript, splitSiteScript } }
const page = { id: 'p', title: 'Contacto', path: '/contacto', status: 'draft', kind: 'website', draft: { version: 1, html: '<main style="background:#ffeecc;color:#102030">Mi sitio</main>', css: 'body{background:#fafafa}', updatedAt: '2026-10-02T12:00:00Z' }, versions: [] }
const form = { id: 'contacto', name: 'Contacto', siteId: 's', pageId: 'p', pageTitle: 'Contacto', pagePath: '/contacto', fields: [{ name: 'nombre', label: 'Nombre', type: 'text', required: true }], connection: { entityId: 'e', entityName: 'Clientes', entitySlug: 'clientes', fieldMapping: { nombre: 'nombre' }, defaultValues: {}, valueMappings: {} } }
const asset = { id: 'a', fileName: 'imagen.svg', mimeType: 'image/svg+xml', sizeBytes: 2000, publicUrl: 'https://ejemplo.invalid/imagen.svg', createdAt: '' }
function response(url: string) {
  if (url === '/api/sites/s/pages/p') return structuredClone(page)
  if (url.endsWith('/forms')) return { forms: [structuredClone(form)] }
  if (url.endsWith('/assets')) return { assets: [asset] }
  if (url === '/api/entities?deleted=exclude') return { entities: [{ id: 'e', name: 'Clientes', slug: 'clientes', isActive: true }] }
  if (url === '/api/entities/clientes/fields') return { fields: [{ id: 'f', name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true }] }
  throw new Error(`Petición no simulada: ${url}`)
}
async function mount(file: string, initial: 'light' | 'dark', props: Record<string, unknown> = {}, options: { fetch?: ReturnType<typeof vi.fn>; error?: boolean } = {}) {
  const resolved = ref(initial)
  const sync = () => { document.documentElement.dataset.theme = resolved.value; document.documentElement.classList.toggle('dark', resolved.value === 'dark'); document.documentElement.style.colorScheme = resolved.value; document.body.dataset.contentTheme = resolved.value }
  sync(); const stop = watch(resolved, sync)
  const fetch = options.fetch ?? vi.fn(async (url: string) => response(url))
  const refresh = vi.fn()
  const meta = vi.fn()
  const toast = { success: vi.fn(), updated: vi.fn(), error: vi.fn() }
  const globals = { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount,
    useTheme: () => ({ resolved }), definePageMeta: meta, useRequestHeaders: () => ({}), useRoute: () => ({ params: { siteId: 's', pageId: 'p' } }), useToast: () => toast,
    usePanelWidth: ({ defaultValue }: { defaultValue: number }) => ({ width: ref(defaultValue), persist: vi.fn() }),
    $fetch: fetch, useFetch: async (input: string | (() => string)) => ({ data: ref(response(typeof input === 'function' ? input() : unref(input))), pending: ref(false), error: ref(options.error ? new Error('Fallo') : null), refresh }) }
  const component = compileVueComponent(file, imports, globals, { client: true, server: false, dev: false })
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, props) }) })
  const link: Component = { setup(_, { slots, attrs }) { return () => h('a', attrs, slots.default?.()) } }
  const clientOnly: Component = { setup(_, { slots }) { return () => slots.default?.() } }
  app.component('NuxtLink', link); app.component('ClientOnly', clientOnly)
  for (const [name, path] of [['SitesCodeEditor', 'components/SitesCodeEditor.client.vue'], ['SitesEditorForms', 'components/SitesEditorForms.vue'], ['SitesAssetLibrary', 'components/SitesAssetLibrary.vue'], ['PanelResizeHandle', 'components/PanelResizeHandle.vue']]) app.component(name!, compileVueComponent(path!, imports, globals))
  const host = document.createElement('div'); document.body.append(host); app.mount(host); apps.push(app)
  await flush()
  return { host, resolved, fetch, refresh, meta, toast, stop }
}
function prepareMeasurements() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) }
  })
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(Range.prototype, 'getClientRects'); Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect') })

describe('contratos HU-168', () => {
  it('conserva los 214 tokens previos y los claros exactos del inventario/defaults', () => {
    expect(Object.keys(baseline.light)).toHaveLength(214)
    for (const [theme, values] of Object.entries(baseline)) for (const [name, value] of Object.entries(values)) expect((theme === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens], `${theme}:${name}`).toBe(value)
    expect(Object.keys(nextBaseline.light).filter(name => !(name in baseline.light)).sort()).toEqual(Object.keys(colors).sort())
    const css = readFileSync('assets/css/theme.css', 'utf8')
    for (const [name, values] of Object.entries(colors)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(values[0]); expect(darkTokens[name as keyof typeof lightTokens]).toBe(values[1])
      for (const value of values) expect(css).toContain(`--brand-${name}: ${rgbChannels(value!)};`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(values[0]!)} !important;`)
    }
  })
  it('congela los déficits claros autorizados y exige AA a cada par oscuro nuevo', () => {
    const pairs = themeContrasts().filter(isEditorContrast)
    expect(pairs.filter(p => p.theme === 'dark')).toHaveLength(editorContrastPairs.length)
    for (const pair of pairs.filter(p => p.theme === 'dark')) expect(pair.ratio, pair.id).toBeGreaterThanOrEqual(pair.minimum)
    expect(pairs.filter(p => p.theme === 'light' && p.ratio < p.minimum).map(p => [p.id, Number(p.ratio.toFixed(3)), p.minimum])).toEqual(deficits)
  })
  it('incluye todas las fuentes en la guardia sin excepciones de colores', () => {
    expect(auditThemeColors()).toEqual([])
    for (const file of files) { expect(migratedThemeFiles).toContain(file); expect(themeColorExceptions[file]).toBeUndefined(); expect(auditThemeSource(file, '<div class="bg-white text-slate-500" style="color:#fff"/>')).toHaveLength(3) }
    expect(contentNeedsLight({ darkReady: true })).toBe(false)
    expect(readFileSync(files[0]!, 'utf8')).toContain('darkReady: true')
  })
})

describe.each(['html', 'css', 'js'] as const)('CodeMirror real, %s', language => {
  it('alterna tema con documento largo, selección, cursor e historial intactos', async () => {
    prepareMeasurements()
    const destroy = vi.spyOn(view.EditorView.prototype, 'destroy')
    const original = ('<div class="demo">Hola</div>\n/* comentario */\nconst valor = 123;\n').repeat(50)
    const emit = vi.fn()
    const { host, resolved, stop } = await mount(files[1]!, 'light', { language, modelValue: original, ariaLabel: 'Editor de prueba', 'onUpdate:modelValue': emit })
    const dom = host.querySelector<HTMLElement>('.cm-editor')!
    const editor = view.EditorView.findFromDOM(dom)!
    expect(editor).toBeTruthy(); expect(editor.state.facet(view.EditorView.darkTheme)).toBe(false)
    editor.dispatch({ changes: { from: 0, insert: 'edición\n' } })
    editor.dispatch({ selection: state.EditorSelection.create([state.EditorSelection.range(3, 35), state.EditorSelection.cursor(90)], 1) })
    const selection = editor.state.selection.toJSON(), document = editor.state.doc.toString(), depth = commands.undoDepth(editor.state)
    for (const mode of ['dark', 'light', 'dark', 'light'] as const) {
      resolved.value = mode; await flush()
      expect(view.EditorView.findFromDOM(dom)).toBe(editor)
      expect(host.querySelector('.cm-editor')).toBe(dom)
      expect(editor.state.doc.toString()).toBe(document)
      expect(editor.state.selection.toJSON()).toEqual(selection)
      expect(commands.undoDepth(editor.state)).toBe(depth)
      expect(editor.state.facet(view.EditorView.darkTheme)).toBe(mode === 'dark')
      expect(destroy).not.toHaveBeenCalled()
      if (language === 'js') expect(syntaxTree(editor.state).length > 0).toBe(mode === 'dark')
    }
    expect(emit).toHaveBeenCalledTimes(1)
    expect(commands.undo(editor)).toBe(true); expect(editor.state.doc.toString()).toBe(original)
    expect(commands.redo(editor)).toBe(true); expect(editor.state.doc.toString()).toBe(document)
    stop()
  })
  it('monta búsqueda, autocompletado y errores reales en oscuro', async () => {
    prepareMeasurements()
    const { host, stop } = await mount(files[1]!, 'dark', { language, modelValue: language === 'html' ? '<di' : language === 'css' ? 'body { col' : 'const prueba = pru', ariaLabel: 'Código' })
    const editor = view.EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!
    editor.dispatch({ selection: { anchor: editor.state.doc.length } })
    expect(openSearchPanel(editor)).toBe(true); await flush()
    expect(host.querySelector('.cm-search')).toBeTruthy()
    const input = host.querySelector<HTMLInputElement>('.cm-search input[name="search"]')!
    input.value = language === 'html' ? 'di' : language === 'css' ? 'col' : 'pru'; input.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    expect(startCompletion(editor)).toBe(true); await new Promise(resolve => setTimeout(resolve, 150)); await flush()
    expect(host.querySelector('.cm-tooltip-autocomplete')).toBeTruthy()
    editor.dispatch(setDiagnostics(editor.state, [{ from: 0, to: 2, severity: 'error', message: 'Error de prueba' }])); await flush()
    expect(host.querySelector('.cm-lintRange-error')).toBeTruthy()
    expect(editor.state.facet(view.EditorView.darkTheme)).toBe(true)
    stop()
  })
})

describe.each(['light', 'dark'] as const)('editor y paneles montados sin red, %s', theme => {
  it('conserva guardado, publicado y toasts de error sin alterar el payload', async () => {
    prepareMeasurements()
    const fetch = vi.fn(async () => ({}))
    const { host, toast, stop } = await mount(files[0]!, theme, {}, { fetch })
    const title = host.querySelector<HTMLInputElement>('.title-line input')!
    title.value = 'Nueva página'; title.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    expect(host.querySelector('.save-state.dirty')?.textContent).toContain('Cambios sin guardar')
    host.querySelectorAll('.header-actions .ghost-button')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/s/pages/p', { method: 'PUT', body: { title: 'Nueva página', path: page.path, html: page.draft.html, css: page.draft.css } })
    expect(host.querySelector('.save-state.saved')?.textContent).toContain('Guardado'); expect(toast.updated).toHaveBeenCalled()
    host.querySelector('.publish-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/s/pages/p/publish', { method: 'POST' }); expect(toast.success).toHaveBeenCalledWith('Página publicada', expect.any(String))
    fetch.mockRejectedValueOnce({ data: { statusMessage: 'Fallo publicación' } })
    host.querySelector('.publish-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(toast.error).toHaveBeenCalledWith('No se pudo publicar', 'Fallo publicación')
    title.value = 'Cambio con error'; title.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    fetch.mockRejectedValueOnce({ data: { statusMessage: 'Fallo guardado' } })
    host.querySelectorAll('.header-actions .ghost-button')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(toast.error).toHaveBeenCalledWith('No se pudo guardar', 'Fallo guardado'); expect(host.querySelector('.save-state.dirty')).toBeTruthy()
    stop()
  })
  it('muestra error de carga sin abrir una vista previa', async () => {
    prepareMeasurements()
    const { host, stop } = await mount(files[0]!, theme, {}, { error: true })
    expect(host.querySelector('.load-error')?.textContent).toContain('No se encontró la página')
    expect(host.querySelector('iframe')).toBeNull()
    stop()
  })
  it('mantiene disabled al subir un recurso y muestra el error recibido', async () => {
    prepareMeasurements()
    let rejectUpload: ((error: unknown) => void) | undefined
    const fetch = vi.fn(() => new Promise((_, reject) => { rejectUpload = reject }))
    const { host, stop } = await mount(files[3]!, theme, { siteId: 's' }, { fetch })
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['contenido'], 'imagen.png', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change', { bubbles: true })); await nextTick()
    expect((host.querySelector('.asset-heading button') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('.asset-heading button')?.textContent).toContain('Subiendo')
    expect(fetch).toHaveBeenCalledWith('/api/sites/s/assets', { method: 'POST', body: expect.any(FormData) })
    rejectUpload!({ data: { statusMessage: 'Archivo rechazado' } }); await flush()
    expect((host.querySelector('.asset-heading button') as HTMLButtonElement).disabled).toBe(false)
    expect(host.querySelector('.asset-error')?.textContent).toBe('Archivo rechazado')
    stop()
  })
  it('aísla escenario, iframe y contenido sin forzar claro toda la página', async () => {
    prepareMeasurements()
    const { host, resolved, meta, stop } = await mount(files[0]!, theme)
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ darkReady: true }))
    expect(host.querySelector('.site-ide')?.closest('.theme-light')).toBeNull()
    const stage = host.querySelector('.preview-stage')!, frame = stage.querySelector('iframe')!
    expect(stage.classList.contains('theme-light')).toBe(true); expect(frame.classList.contains('theme-light')).toBe(true)
    const srcdoc = frame.getAttribute('srcdoc')
    expect(srcdoc).toContain('background:#ffeecc'); expect(srcdoc).toContain('color:#102030'); expect(srcdoc).toContain(':root{color-scheme:light!important}')
    resolved.value = theme === 'dark' ? 'light' : 'dark'; await flush()
    expect(host.querySelector('iframe')).toBe(frame); expect(frame.getAttribute('srcdoc')).toBe(srcdoc)
    const css = readFileSync(files[0]!, 'utf8')
    expect(css).toContain('.preview-stage{'); expect(css).toContain('background:rgb(var(--brand-sites-editor-preview))')
    expect(lightTokens['sites-editor-preview']).toBe('#E9EEF2'); expect(darkTokens['sites-editor-preview']).toBe('#E9EEF2')
    stop()
  })
  it('conserva código/dividido/preview y los dos divisores reales', async () => {
    prepareMeasurements()
    const { host, stop } = await mount(files[0]!, theme)
    expect(host.querySelectorAll('.panel-resize-handle')).toHaveLength(2)
    const buttons = host.querySelectorAll('.segmented button')
    buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(host.querySelector('.mode-code')).toBeTruthy(); expect(host.querySelector('iframe')).toBeNull()
    buttons[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(host.querySelector('.mode-preview')).toBeTruthy(); expect(host.querySelector('.code-pane')).toBeNull()
    buttons[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(host.querySelector('.mode-split')).toBeTruthy(); expect(host.querySelectorAll('.panel-resize-handle')).toHaveLength(2)
    stop()
  })
  it('conserva conexión y POST, validación y error de guardado del formulario', async () => {
    prepareMeasurements()
    const fetch = vi.fn(async (url: string) => { if (url.endsWith('/connection')) throw { data: { statusMessage: 'Error simulado' } }; return response(url) })
    const { host, stop } = await mount(files[2]!, theme, { siteId: 's', pageId: 'p', pageTitle: 'Contacto', pagePath: '/contacto', pageStatus: 'draft', pageVersion: 1, dirty: false, activeFile: 'html', sidebarWidth: 250 }, { fetch })
    host.querySelector('.form-item')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(host.querySelector('.connection-drawer')).toBeTruthy(); expect(host.querySelector('.drawer-body select')).toBeTruthy()
    expect((host.querySelector('.connect') as HTMLButtonElement).disabled).toBe(false)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/sites/s/forms/connection', { method: 'POST', body: { pageId: 'p', formKey: 'contacto', entityId: 'e', fieldMapping: { nombre: 'nombre' }, defaultValues: {}, valueMappings: {} } })
    expect(host.querySelector('.drawer-error')?.textContent).toBe('Error simulado')
    stop()
  })
  it('conserva miniatura clara y copia la URL original del recurso', async () => {
    prepareMeasurements()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { host, stop } = await mount(files[3]!, theme, { siteId: 's' })
    expect(host.querySelector('.asset-thumb')?.classList.contains('theme-light')).toBe(true)
    expect(host.querySelector('img')?.getAttribute('src')).toBe(asset.publicUrl)
    host.querySelector('.asset-list button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush()
    expect(writeText).toHaveBeenCalledWith(asset.publicUrl)
    expect(host.querySelector('.asset-list button svg')).toBeTruthy()
    stop()
  })
})
