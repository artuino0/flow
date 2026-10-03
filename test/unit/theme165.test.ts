// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { compileVueComponent } from '../helpers/vueComponent'
import baseline from '../fixtures/themeBaseline165.json'
import nextBaseline from '../fixtures/themeBaseline167.json'
import originals from '../fixtures/themeDesigner165.json'
import { lightTokens, darkTokens, rgbChannels } from '../../utils/themeTokens'
import { auditThemeColors, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { contentNeedsLight, createThemeController } from '../../utils/theme'
import { isDesignerContrast, themeContrasts } from '../helpers/themeContrast'
import * as graph from '../../utils/designerGraph'
import * as motion from '../../utils/designerMotion'
import * as icons from '../../utils/moduleIcons'
import * as client from '../../utils/designerClient'
import * as warnings from '../../utils/designerWarnings'
import * as chat from '../../utils/designerChat'
import * as errors from '../../utils/designerValidationErrors'
import * as state from '../../utils/designerBlueprintState'
import * as badges from '../../utils/fieldTypeBadge'
import * as fields from '../../utils/designerFieldForm'
import * as chattito from '../../utils/designerChattito'
import * as markdown from '../../utils/designerMarkdown'
import * as core from '@vue-flow/core'
import type { Blueprint } from '../../server/utils/blueprint/schema'
import art from '../fixtures/themeChattito165.json'

const apps: App[] = []
// El compilador SFC carga dependencias CommonJS; evita dos stores ESM/CJS de vue-flow.
const actualCore = createRequire(import.meta.url)('@vue-flow/core') as typeof core
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
const base: Blueprint = { version: 1, summary: 'Actual', associations: [], modules: [{ ref: 'clientes', slug: 'clientes', name: 'Clientes', kind: 'dimension', action: 'extend', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] }] }
const proposal: Blueprint = { ...base, summary: 'Propuesta', modules: [{ ...base.modules[0]!, fields: [...base.modules[0]!.fields, { name: 'saldo', label: 'Saldo', dataType: 'currency' }] }, { ref: 'ventas', slug: 'ventas', name: 'Ventas', kind: 'hecho', action: 'create', fields: [{ name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } }] }] }
const diff: graph.DesignerDiff = { newModules: [{ slug: 'ventas', name: 'Ventas' }], newCatalogs: [], extendedModules: [{ slug: 'clientes', fields: ['saldo'] }], relations: [], associations: [], states: [], merges: [], plan: { code: 'starter', name: 'Starter', used: 1, added: 1, after: 2, limit: 5, allowed: true } }
const warningItems: warnings.DesignerWarningItem[] = ['different', 'unsupported', 'elsewhere', 'pending', 'info'].map(kind => ({ kind: kind as warnings.DesignerWarningKind, text: `Aviso ${kind}`, details: ['Detalle conservado'] }))
const explanation = 'Resumen del diseño.\n\n### Diseño\n\n**Motivo** y `código`.\n\n- Punto\n\n> Cita\n\n[Referencia](https://ejemplo.local)\n\n```txt\nbloque\n```'
const imports = {
  '~/utils/designerGraph': graph, '~/utils/designerMotion': motion, '~/utils/moduleIcons': icons,
  '~/utils/designerClient': client, '~/utils/designerWarnings': warnings, '~/utils/designerChat': chat,
  '~/utils/designerValidationErrors': errors, '~/utils/designerBlueprintState': state,
  '~/utils/fieldTypeBadge': badges, '~/utils/designerFieldForm': fields, '~/utils/designerChattito': chattito,
  '~/utils/designerMarkdown': markdown, '~/utils/themeTokens': { lightTokens, darkTokens }
}
function setupTheme(theme: 'light' | 'dark') {
  const resolved = ref(theme)
  const controller = createThemeController({ storage: () => ({ getItem: () => theme, setItem: vi.fn() }), media: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }), apply(value) {
    document.documentElement.dataset.theme = value
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.style.colorScheme = value
    document.body.dataset.contentTheme = value
  } }, (_mode, value) => { resolved.value = value })
  controller.initialize()
  return { resolved, controller }
}
function mount(component: Component, props: Record<string, unknown> = {}, registry: Record<string, Component> = {}) {
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp(component, props)
  for (const [name, value] of Object.entries(registry)) app.component(name, value)
  app.mount(host); apps.push(app)
  return host
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; document.querySelectorAll('style[data-theme165]').forEach(style => style.remove()); Reflect.deleteProperty(SVGElement.prototype, 'getBBox'); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('contratos HU-165', () => {
  it('congela todos los valores previos contra HEAD y conserva cada claro nuevo', () => {
    for (const [theme, values] of Object.entries(baseline)) for (const [name, value] of Object.entries(values)) expect((theme === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens]).toBe(value)
    const newNames = Object.keys(nextBaseline.light).filter(name => !(name in baseline.light) && !name.startsWith('resize-'))
    expect(newNames.sort()).toEqual(Object.keys(originals).sort())
    for (const [name, values] of Object.entries(originals)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(values[0])
      expect(darkTokens[name as keyof typeof lightTokens]).toBe(values[1])
      expect(values[1]).toMatch(/^#[\dA-F]{6}$/)
      expect(readFileSync('assets/css/theme.css', 'utf8')).toContain(`--brand-${name}: ${rgbChannels(values[0]!)};`)
    }
  })
  it('migra la ruta y cierra la guardia sin excepciones nuevas de arte', () => {
    expect(readFileSync('pages/disenador.vue', 'utf8')).toContain('darkReady: true')
    expect(contentNeedsLight({ darkReady: true })).toBe(false)
    for (const file of ['pages/disenador.vue', 'components/designer/DesignerCanvas.client.vue', 'components/MarkdownView.vue', 'utils/designerChattito.ts', 'utils/designerWarnings.ts', 'utils/designerChat.ts', 'utils/designerClient.ts']) expect(migratedThemeFiles).toContain(file)
    expect(auditThemeColors()).toEqual([])
    expect(readFileSync('pages/facturacion/index.vue', 'utf8')).toContain('darkReady: true')
    expect(readFileSync('components/PrintReportPreview.vue', 'utf8')).toContain('theme-light')
  })
  it('conserva byte a byte arte y animaciones, incluida la lógica propia del diseñador', () => {
    for (const [file, hash] of Object.entries(art)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash)
  })
  it('lista aparte los claros deficientes del diseñador y exige AA oscuro', () => {
    const pairs = themeContrasts().filter(isDesignerContrast)
    expect(pairs.filter(pair => pair.ratio < pair.minimum).map(pair => [pair.id, Number(pair.ratio.toFixed(3)), pair.minimum])).toEqual([
      ['light:designer-node-meta/designer-node-head', 3.726, 4.5],
      ['light:designer-node-meta/designer-new-head', 3.688, 4.5],
      ['light:primary-fg/designer-new', 3.256, 4.5],
      ['light:designer-added-text/designer-added-bg', 4.083, 4.5],
      ['light:designer-section-text/designer-section-bg', 4.389, 4.5],
      ['light:designer-type/surface', 2.659, 4.5],
      ['light:designer-type/designer-added-row', 2.401, 4.5],
      ['light:designer-node-border/surface', 1.923, 3],
      ['light:designer-edge/bg', 2.667, 3], ['light:designer-existing-edge/bg', 2.404, 3],
      ['light:designer-new-arrow/bg', 2.628, 3],
      // BUG-166 amplía la medición a secciones y minimapa; los claros siguen siendo los originales.
      ['light:designer-edge/designer-section-bg', 2.707, 3],
      ['light:designer-existing-edge/designer-section-bg', 2.440, 3],
      ['light:designer-new-arrow/designer-section-bg', 2.668, 3],
      ['light:designer-minimap-existing/designer-minimap-bg', 2.368, 3],
      ['light:designer-minimap-existing/designer-minimap-section', 1.000, 3],
      ['light:designer-minimap-new/designer-minimap-section', 1.375, 3],
      ['light:designer-minimap-system/designer-minimap-section', 2.009, 3]
    ])
    for (const pair of pairs.filter(pair => pair.theme === 'dark')) expect(pair.ratio, pair.id).toBeGreaterThanOrEqual(pair.minimum)
  })
})

describe.each(['light', 'dark'] as const)('montajes del diseñador sin red: %s', theme => {
  it.each(['normal', 'selected'])('actualiza lienzo y flechas (%s) sin reiniciar estado', async edgeMode => {
    const { resolved, controller } = setupTheme(theme)
    const viewport = reactive({ x: 74, y: -52, zoom: .72 })
    const fitView = vi.fn()
    let latest: { nodes: core.Node[]; edges: core.Edge[] } = { nodes: [], edges: [] }
    const flow = defineComponent({ props: ['nodes', 'edges'], emits: ['update:nodes', 'update:edges', 'node-click'], setup(props, { slots, emit }) {
      return () => {
        latest = { nodes: props.nodes, edges: props.edges }
        return h('div', { 'data-viewport': JSON.stringify(viewport) }, [
          slots.default?.(),
          ...props.nodes.map((node: core.Node) => h('div', { 'data-node': node.id, onClick: () => emit('node-click', { node }) }, slots[`node-${node.type}`]?.({ data: node.data })))
        ])
      }
    } })
    const background = defineComponent({ props: ['color', 'id'], setup(props) { return () => h('svg', { 'data-grid': props.id }, [h('path', { stroke: props.color })]) } })
    const minimap = defineComponent({ props: ['nodeColor', 'maskColor'], setup(props) { return () => h('svg', { 'data-minimap': true }, [
      h('rect', { 'data-kind': 'new', fill: props.nodeColor({ data: { module: { state: 'new' } } }) }),
      h('rect', { 'data-kind': 'existing', fill: props.nodeColor({ data: { module: { state: 'existing' } } }) }),
      h('rect', { 'data-kind': 'system', fill: props.nodeColor({ data: { module: { system: true } } }) }),
      h('rect', { 'data-kind': 'section', fill: props.nodeColor({ type: 'section', data: { title: 'Grupo' } }) }),
      h('path', { fill: props.maskColor })
    ]) } })
    const component = compileVueComponent('components/designer/DesignerCanvas.client.vue', { ...imports,
      '@vue-flow/core': { ...core, VueFlow: flow, Handle: { render: () => h('span') }, useVueFlow: () => ({ fitView, zoomIn: vi.fn(), zoomOut: vi.fn() }) },
      '@vue-flow/background': { Background: background }, '@vue-flow/minimap': { MiniMap: minimap }, '@vue-flow/controls': { Controls: { render: () => h('div') } }
    }, { useTheme: () => ({ resolved }) })
    const props = reactive({ graph: graph.buildDesignerGraph(base, proposal, diff), positions: { clientes: { x: 120, y: 210 } }, selectedId: 'clientes', focusId: null, selectedEdgeId: edgeMode === 'selected' ? 'relation:ventas:cliente:clientes' : null, relationFilter: 'none', changedIds: ['ventas'], revealEdgeIds: ['relation:ventas:cliente:clientes'], revealFieldKeys: ['clientes:saldo'] })
    const host = mount(component, props); await flush()
    expect(host.querySelector('.theme-light')).toBeNull()
    expect(host.querySelector('.is-selected')).not.toBeNull()
    expect(host.textContent).toContain('Se agrega')
    expect(host.textContent).toContain('Nuevo')
    expect(host.querySelector('.is-fresh')).not.toBeNull()
    expect(latest.edges[0]!.class).toContain('designer-enter-edge')
    const nodes = latest.nodes
    // Representa la posición local tras arrastre antes de persistirla.
    nodes.find(node => node.id === 'clientes')!.position = { x: 420, y: 380 }
    const before = JSON.stringify(viewport)
    const next = theme === 'light' ? 'dark' : 'light'
    controller.setMode(next); await flush()
    const palette = next === 'dark' ? darkTokens : lightTokens
    expect(document.documentElement.dataset.theme).toBe(next)
    expect(host.querySelector('[data-grid="minor-grid"] path')?.getAttribute('stroke')).toBe(palette['designer-grid-minor'])
    expect(host.querySelector('[data-minimap] rect')?.getAttribute('fill')).toBe(palette['designer-minimap-new'])
    for (const kind of ['existing', 'system', 'section'] as const) expect(host.querySelector(`[data-minimap] [data-kind="${kind}"]`)?.getAttribute('fill')).toBe(palette[`designer-minimap-${kind}`])
    expect(host.querySelector('[data-minimap]')?.classList.contains('!bg-brand-designer-minimap-bg')).toBe(true)
    expect(host.querySelector('[data-minimap] path')?.getAttribute('fill')).toBe('rgb(var(--brand-designer-minimap-mask) / 0.6)')
    expect(latest.edges[0]!.labelBgStyle).toEqual({ fill: 'rgb(var(--brand-designer-label-bg))', fillOpacity: .92 })
    expect((latest.edges[0]!.markerEnd as core.EdgeMarker).color).toBe(palette[edgeMode === 'selected' ? 'designer-selected-edge' : 'designer-new-arrow'])
    const edgeStyle = latest.edges[0]!.style
    expect(typeof edgeStyle).not.toBe('function')
    expect(typeof edgeStyle === 'function' ? undefined : edgeStyle?.stroke).toBe(palette[edgeMode === 'selected' ? 'designer-selected-edge' : 'designer-new'])
    expect(latest.nodes).toBe(nodes)
    expect(latest.nodes.find(node => node.id === 'clientes')!.position).toEqual({ x: 420, y: 380 })
    expect(host.querySelector('.is-selected')).not.toBeNull()
    expect(host.querySelector('.is-fresh')).not.toBeNull()
    expect(latest.edges[0]!.class).toContain('designer-enter-edge')
    expect(JSON.stringify(viewport)).toBe(before)
    expect(fitView).not.toHaveBeenCalled()
    controller.setMode(theme); await flush()
    expect(latest.nodes).toBe(nodes)
    expect(fitView).not.toHaveBeenCalled()
  })
  it.each(['normal', 'empty', 'credits', 'error', 'applied'])('monta página y chat con API simulada (%s)', async mode => {
    setupTheme(theme)
    const design = mode === 'empty' ? { ...base, modules: [] } : proposal
    const session: client.DesignerSession = { id: 's', status: mode === 'applied' ? 'applied' : 'draft', messages: mode === 'empty' ? [] : [{ role: 'user', content: 'Agrega ventas', createdAt: '2026-10-02' }, { role: 'assistant', content: 'Propuesta', explanation, warningItems, createdAt: '2026-10-02' }], blueprint: design, creditsConsumed: 2, version: 1, createdAt: '2026-10-02', updatedAt: '2026-10-02' }
    let rejectGeneration: ((error: unknown) => void) | undefined
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/module-designer/sessions') return options?.method === 'POST' ? session : [session]
      if (url === '/api/module-designer/sessions/s') return session
      if (url === '/api/blueprints/current') return mode === 'empty' ? design : base
      if (url === '/api/billing/ai-credits') return { included: 10, used: 2, includedRemaining: mode === 'credits' ? 0 : 8, packages: 0 }
      if (url === '/api/navigation') return { layout: { groups: [] }, entities: [] }
      if (url === '/api/module-designer/layout') return { positions: {} }
      if (url === '/api/module-designer/applications') return []
      if (url === '/api/blueprints/validate') return { normalized: design, errors: [], diff, merges: [] }
      if (url === '/api/module-designer/sessions/s/messages') return new Promise((_resolve, reject) => { rejectGeneration = reject })
      throw new Error(`Petición no simulada: ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const globals = { definePageMeta: vi.fn(), useHead: vi.fn(), useConfirm: () => ({ confirm: vi.fn(async () => true) }), usePanelWidth: () => ({ width: ref(360), startResize: vi.fn() }) }
    const modal = defineComponent({ props: ['open', 'readOnly'], setup(props) { return () => h('div', { 'data-modal': 'field', 'data-open': String(props.open), 'data-readonly': String(props.readOnly) }) } })
    const component = compileVueComponent('pages/disenador.vue', { ...imports, '~/components/FieldFormModal.vue': { default: modal } }, globals)
    const markdownComponent = compileVueComponent('components/MarkdownView.vue', imports)
    const canvas = defineComponent({ emits: ['select'], setup(_, { emit }) { return () => h('button', { 'data-canvas-select': true, onClick: () => emit('select', 'clientes') }, 'Seleccionar Clientes') } })
    const stub: Component = { setup(_, { slots }) { return () => h('div', {}, slots.default?.()) } }
    const host = mount(component, {}, { DesignerCanvas: canvas, DesignerCanvasClient: canvas, ClientOnly: stub, NuxtLink: stub, ChattitoMessageAvatar: stub, MarkdownView: markdownComponent, PanelResizeHandle: stub, IconPicker: stub })
    await flush(); await flush()
    expect(host.querySelector('.theme-light')).toBeNull()
    if (mode === 'empty') {
      expect(host.textContent).toContain('Diseña tu estructura')
      expect(host.querySelector('[data-canvas-select]')).toBeNull()
      expect(host.textContent).toContain('PRUEBA CON UNA IDEA')
      return
    }
    expect(host.querySelector<HTMLInputElement>('[aria-label="Nombre del diseño"]')?.value).toBe('Propuesta')
    if (mode === 'credits') {
      expect(host.textContent).toContain('Sin créditos suficientes')
      expect(host.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
      return
    }
    if (mode === 'applied') {
      expect(host.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
      expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Revisar y aprobar'))?.disabled).toBe(true)
      return
    }
    if (mode === 'error') {
      const prompt = host.querySelector<HTMLTextAreaElement>('textarea')!
      prompt.value = 'Otro cambio'; prompt.dispatchEvent(new Event('input', { bubbles: true })); await flush()
      const send = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Enviar')!
      send.click(); await flush()
      expect(host.querySelector('.designer-typing-dots')).not.toBeNull()
      expect(host.textContent).toContain('Diseñando…')
      expect(rejectGeneration).toBeDefined()
      rejectGeneration!({ statusCode: 503, data: { message: 'La IA está saturada…', data: { code: 'ai_unavailable' } } }); await flush(); await flush()
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('La IA está saturada')
      expect(host.querySelector('.designer-chat-scroll [role="alert"]')?.textContent).toContain('La IA no está disponible')
      expect(host.textContent).toContain('Reintentar')
      expect(host.querySelector('.designer-typing-dots')).toBeNull()
      return
    }
    expect(host.querySelectorAll('[aria-label="Avisos de la propuesta"] details')).toHaveLength(5)
    for (const title of ['Quedó diferente', 'Todavía no disponible', 'Se configura en otra parte', 'Te toca a ti', 'Notas del diseño']) expect(host.textContent).toContain(title)
    expect(host.querySelector('summary')?.className).toContain('focus-visible:outline-brand-blue')
    for (const selector of ['h3', 'ul', 'code', 'pre', 'blockquote']) expect(host.querySelector(`.designer-markdown ${selector}`), selector).not.toBeNull()
    // El renderer aprobado neutraliza enlaces; no se cambia esa política por el tema.
    expect(host.querySelector('.designer-markdown a')).toBeNull()
    expect(host.querySelector('.designer-markdown')?.textContent).toContain('https://ejemplo.local')
    host.querySelector<HTMLButtonElement>('[data-canvas-select]')!.click(); await flush()
    expect(host.textContent).toContain('Agregar campo')
    expect(host.textContent).toContain('Existente')
    expect(host.textContent).toContain('Se agrega')
    const inspectorButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.designer-inspector button')].find(button => button.textContent?.trim() === label)!
    inspectorButton('Relaciones').click(); await flush()
    expect(host.querySelector('.designer-inspector')?.textContent).toContain('N · Cliente · 1')
    inspectorButton('Estados').click(); await flush()
    expect(host.querySelector('.designer-inspector')?.textContent).toContain('Este módulo no tiene estados definidos')
    inspectorButton('Campos').click(); await flush()
    const existingField = [...host.querySelectorAll<HTMLButtonElement>('.designer-inspector button')].find(button => button.textContent?.includes('Nombre') && button.textContent?.includes('Existente'))!
    existingField.click(); await flush()
    expect(host.querySelector('[data-modal="field"]')?.getAttribute('data-readonly')).toBe('true')
    expect(host.querySelector('[data-modal="field"]')?.getAttribute('data-open')).toBe('true')
    inspectorButton('Agregar campo').click(); await flush()
    expect(host.querySelector('[data-modal="field"]')?.getAttribute('data-readonly')).toBe('false')
    const approve = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Revisar y aprobar'))!
    approve.click(); await flush()
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Impacto en el plan')
    expect(host.querySelector('[class~="bg-brand-designer-review-overlay/50"]')).not.toBeNull()
    expect(fetch.mock.calls.every(([url]) => !url.includes('/generate') && !url.includes('/apply'))).toBe(true)
  })
  it.each(['empty', 'nodes'])('monta vue-flow real (%s) y mantiene su viewport al alternar tema', async mode => {
    const { resolved, controller } = setupTheme(theme)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const stylesheet = document.createElement('style')
    stylesheet.dataset.theme165 = ''
    stylesheet.textContent = readFileSync('node_modules/@vue-flow/core/dist/style.css', 'utf8')
    document.head.append(stylesheet)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return parseFloat(this.style.width) || 1000 })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return parseFloat(this.style.height) || 600 })
    // jsdom carece de medición SVG; la geometría de la etiqueta se simula sin navegador.
    Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 0, y: 0, width: 80, height: 12 }) })
    let store: ReturnType<typeof core.useVueFlow> | undefined
    const component = compileVueComponent('components/designer/DesignerCanvas.client.vue', { ...imports, '@vue-flow/core': { ...actualCore, useVueFlow: () => { store = actualCore.useVueFlow(); return store } } }, { useTheme: () => ({ resolved }) })
    const host = mount(component, { graph: mode === 'empty' ? { modules: [], sections: [], edges: [] } : graph.buildDesignerGraph(base, proposal, diff), positions: {}, selectedId: mode === 'empty' ? null : 'clientes', focusId: null, selectedEdgeId: null, relationFilter: 'none', changedIds: [], revealEdgeIds: [], revealFieldKeys: [] })
    await flush()
    // MiniMap omite nodos sin dimensiones. Simula únicamente la medición ausente en jsdom.
    for (const node of store!.getNodes.value) { node.dimensions = { width: 240, height: 100 }; node.handleBounds = { source: [], target: [] } }
    await flush()
    if (mode === 'nodes') expect(store!.getNodesInitialized.value.length, JSON.stringify(store!.getNodes.value.map(node => ({ id: node.id, dimensions: node.dimensions, handles: node.handleBounds })))).toBeGreaterThan(0)
    store!.viewport.value.x = 87; store!.viewport.value.y = -43; store!.viewport.value.zoom = .71
    if (mode === 'nodes') store!.findNode('clientes')!.position = { x: 515, y: 270 }
    await flush()
    const viewport = host.querySelector<HTMLElement>('.vue-flow__transformationpane')!
    expect(viewport).not.toBeNull()
    const before = viewport.style.transform
    expect(host.querySelectorAll('.vue-flow__controls-button').length).toBeGreaterThan(0)
    expect(host.querySelector('.vue-flow__minimap')).not.toBeNull()
    controller.setMode(theme === 'light' ? 'dark' : 'light'); await flush()
    expect(host.querySelector<HTMLElement>('.vue-flow__transformationpane')!.style.transform).toBe(before)
    expect(store!.viewport.value).toEqual({ x: 87, y: -43, zoom: .71 })
    if (mode === 'nodes') {
      expect(store!.findNode('clientes')!.position).toEqual({ x: 515, y: 270 })
      expect(host.querySelector('.is-selected')).not.toBeNull()
      const nextTokens = theme === 'light' ? darkTokens : lightTokens
      expect([...host.querySelectorAll('.vue-flow__minimap rect')].some(rect => rect.getAttribute('fill') === nextTokens['designer-minimap-new']), host.querySelector('.vue-flow__minimap')?.outerHTML).toBe(true)
      expect([...host.querySelectorAll('.vue-flow__minimap rect')].some(rect => rect.getAttribute('fill') === nextTokens['designer-minimap-section'])).toBe(true)
    }
    const palette = theme === 'light' ? darkTokens : lightTokens
    expect(host.querySelector('.vue-flow__background pattern path')?.getAttribute('stroke')).toBe(palette['designer-grid-minor'])
  })
})
