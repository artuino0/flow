// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, Suspense, useId, watch, watchEffect, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from '@vue/compiler-sfc'
import { createRequire } from 'node:module'
import { compileVueComponent } from '../helpers/vueComponent'
import { lightTokens, darkTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight } from '../../utils/theme'
import { auditThemeColors, auditThemeSource, migratedThemeFiles, themeColorExceptions } from '../../scripts/auditThemeColors'
import { automationReportContrastPairs, isAutomationReportContrast, themeContrasts } from '../helpers/themeContrast'
import * as reports from '../../composables/usePrintReports'
import * as layout from '../../utils/printLayout'
import * as parameters from '../../utils/reportParameters'
import * as designer from '../../utils/reportDesigner'
import * as workflow from '../../utils/workflowFields'
import * as cells from '../../utils/reportCellFormat'
import baseline from '../fixtures/themeBaseline170.json'
import colors from '../fixtures/themeAutomationReport170.json'
import deficits from '../fixtures/themeAutomationReportDeficits170.json'
import paper from '../fixtures/themePaper170.json'

const files = [
  'pages/triggers/index.vue', 'pages/triggers/[id]/editar.vue', 'pages/reportes/nuevo.vue',
  'pages/registros/[entity]/reportes/nuevo.vue', 'pages/registros/[entity]/reportes/[id]/editar.vue',
  ...['WorkflowActionNode', 'WorkflowConditionRows', 'WorkflowFieldValue', 'WorkflowUpsertRecordConfig',
    'PrintReportPage', 'PrintReportDesigner', 'PrintReportFieldPicker', 'PrintReportFieldTree',
    'PrintReportFilterSelect', 'PrintReportLayoutControls', 'PrintReportDataControls', 'PrintReportParameterModal', 'ReportOptionSelect']
    .map(name => `components/${name}.vue`)
]
const apps: App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
const field = { id: 'f', name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: false, isPrimary: false, isUnique: false, isNullable: true, validationRules: {} }
const leaf: reports.FieldTreeLeaf = { type: 'leaf', fieldName: 'nombre', label: 'Nombre', dataType: 'text' }
const tree = { entityName: 'Clientes', fields: [leaf] }
const source: reports.ColumnSource = { side: 'base', forwardHops: [], field: 'nombre' }
const dsl: reports.PrintReportDsl = { title: 'Clientes', baseEntity: 'clientes', includeDeletedBase: false, groupBy: [], columns: [{ key: 'nombre', label: 'Nombre', kind: 'detalle', source }] }
const result: reports.PrintReportResult = { title: 'Clientes', columns: [{ key: 'nombre', label: 'Nombre', kind: 'detalle', dataType: 'text' }], groups: [], ungroupedRows: [{ values: { nombre: 'Ana' }, isDeleted: false }], grandTotals: {}, criteria: ['Nombre contiene Ana'] }
const detail = { id: 't', name: 'Avisar', entityId: 'e', entitySlug: 'clientes', entityName: 'Clientes', triggerEvent: 'on_update', isActive: true, condition: { field: 'nombre', operator: 'contains', value: 'Ana' }, decisionCondition: { field: 'nombre', operator: 'eq', value: 'Ana' }, actions: [{ id: 'a', actionType: 'webhook', executionOrder: 1, config: { url: 'https://ejemplo.invalid', branch: 'yes' } }] }
const rows = ['success', 'failed', 'retrying', 'dead_letter'].map((status, i) => ({ ...detail, id: 't' + i, actionsCount: 1, lastLogStatus: status, isActive: i % 2 === 0 }))
const logs = rows.map((row, i) => ({ id: 'l' + i, recordId: 'r', status: row.lastLogStatus, attemptCount: i + 1, lastError: i ? 'Error simulado' : null, createdAt: '2026-10-03T12:00:00Z' }))
function theme(value: 'light' | 'dark') {
  document.documentElement.dataset.theme = value
  document.documentElement.classList.toggle('dark', value === 'dark')
  document.documentElement.style.colorScheme = value
  document.body.dataset.contentTheme = value
}
async function mount(file: string, mode: 'light' | 'dark', props: Record<string, unknown> = {}, state: { empty?: boolean; loading?: boolean; error?: boolean; fetch?: ReturnType<typeof vi.fn>; lightScope?: boolean } = {}) {
  theme(mode)
  const fetch = state.fetch ?? vi.fn(async (url: string) => {
    if (url === '/api/print-reports/preview') return structuredClone(result)
    if (url === '/api/trigger-preview') return { matches: true, decision: true, actions: detail.actions }
    if (url === '/api/reports/preview') return { queryDsl: { title: 'Clientes', measures: [] }, result: { columns: [{ key: 'label', label: 'Nombre' }], rows: [{ label: 'Ana' }] } }
    if (url === '/api/print-reports/parameter-options') return { options: [{ value: 'ana', label: 'Ana' }], recordId: false, more: false }
    if (url.endsWith('/fields')) return { fields: [field] }
    if (url === '/api/triggers' || url.startsWith('/api/triggers/') || url.startsWith('/api/trigger-logs/') || url === '/api/print-reports' || url === '/api/reports') return { id: 'nuevo' }
    throw new Error(`Petición no simulada: ${url}`)
  })
  const refresh = vi.fn(), meta = vi.fn(), push = vi.fn(), toast = { success: vi.fn(), updated: vi.fn(), error: vi.fn() }
  const pending = ref(state.loading ?? false), error = ref(state.error ? new Error('Fallo simulado') : null)
  const globals = { ref, computed, reactive, watch, watchEffect, onMounted, onBeforeUnmount, nextTick, useId,
    useToast: () => toast, useConfirm: () => ({ confirm: vi.fn(async () => true) }), usePlanLimit: () => ({ checkBeforeCreate: vi.fn(async () => true), handlePlanLimitError: vi.fn(async () => false) }),
    definePageMeta: meta, useRouter: () => ({ push }), navigateTo: push,
    useRoute: () => ({ params: { id: 't', entity: 'clientes' } }), useRequestHeaders: () => ({}), useHead: vi.fn(), $fetch: fetch,
    useFetch: (input: string | (() => string)) => {
      const url = typeof input === 'function' ? input() : input
      let data: unknown
      if (url === '/api/entities') data = { entities: [{ id: 'e', slug: 'clientes', name: 'Clientes' }] }
      else if (url === '/api/triggers') data = state.empty ? [] : structuredClone(rows)
      else if (url === '/api/triggers/t') data = structuredClone(detail)
      else if (url === '/api/trigger-logs') data = state.empty ? [] : logs
      else if (url.endsWith('/fields')) data = { fields: [field] }
      else if (url === '/api/tenant/branding') data = { name: 'Flow QA', fiscalData: {}, hasLogo: false, email: null, phone: null }
      else if (url === '/api/print-reports/t') data = { id: 't', title: 'Clientes', dsl }
      else if (url === '/api/relation-definitions') data = []
      else throw new Error(`useFetch no simulado: ${url}`)
      return { data: ref(data), pending, error, refresh, status: ref('success') }
    }
  }
  const reportImports = { ...reports, usePrintReportFieldTree: () => ({ data: ref(tree), pending: ref(state.loading ?? false), error: ref(state.error ? new Error('Fallo') : null) }), usePrintReportPreviewDraft: () => ref(null) }
  const imports = { '~/composables/usePrintReports': reportImports, '~/utils/printLayout': layout, '~/utils/reportParameters': parameters, '~/utils/reportDesigner': designer, '~/utils/workflowFields': workflow, '~/utils/reportCellFormat': cells }
  const component = compileVueComponent(file, imports, globals)
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, props) }) })
  const link: Component = { setup(_, { slots, attrs }) { return () => h('a', attrs, slots.default?.()) } }
  const header: Component = { setup(_, { slots }) { return () => h('header', [slots.default?.(), slots.actions?.(), slots['toolbar-left']?.()]) } }
  app.component('NuxtLink', link); app.component('ListPageHeader', header)
  for (const name of ['WorkflowActionNode', 'WorkflowConditionRows', 'WorkflowFieldValue', 'WorkflowUpsertRecordConfig', 'PrintReportDesigner', 'PrintReportSheet', 'PrintReportPage', 'PrintReportFieldTree', 'PrintReportFieldPicker', 'PrintReportLayoutControls', 'PrintReportDataControls', 'PrintReportFilterSelect', 'PrintReportParameterModal', 'ReportOptionSelect']) {
    app.component(name, compileVueComponent(`components/${name}.vue`, imports, globals))
  }
  const host = document.createElement('div')
  if (state.lightScope) host.classList.add('theme-light')
  document.body.append(host); app.mount(host); apps.push(app); await flush()
  return { host, fetch, refresh, meta, push, toast, pending, error }
}
function button(host: Element, text: string) {
  const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(text) || item.getAttribute('aria-label') === text)
  expect(target, text).toBeTruthy(); return target!
}
async function click(host: Element, text: string) { button(host, text).click(); await flush() }
function measurements() {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('report-footer') ? 900 : this.classList.contains('report-body') ? 100 : 0
    return { x: 0, y: top, left: 0, right: 800, top, bottom: top + 20, width: 800, height: 20, toJSON: () => ({}) }
  })
}
function style(css: string) { const element = document.createElement('style'); element.dataset.theme170 = ''; element.textContent = css; document.head.append(element) }
afterEach(() => {
  apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''
  document.querySelectorAll('style[data-theme170]').forEach(element => element.remove())
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(document, 'fonts')
  vi.restoreAllMocks()
})

describe('contratos HU-170', () => {
  it('congela los 263 tokens previos completos y los diez claros nuevos exactos', () => {
    expect(Object.keys(baseline.light)).toHaveLength(263)
    for (const [mode, values] of Object.entries(baseline)) for (const [name, value] of Object.entries(values)) expect((mode === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens], `${mode}:${name}`).toBe(value)
    expect(Object.keys(lightTokens).filter(name => !(name in baseline.light)).sort()).toEqual(Object.keys(colors).sort())
    const css = readFileSync('assets/css/theme.css', 'utf8')
    for (const [name, values] of Object.entries(colors)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(values[0]); expect(darkTokens[name as keyof typeof lightTokens]).toBe(values[1])
      for (const value of values) expect(css).toContain(`--brand-${name}: ${rgbChannels(value!)};`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(values[0]!)} !important;`)
    }
  })
  it('congela las cifras claras heredadas y exige AA a todos los pares oscuros nuevos', () => {
    const values = themeContrasts().filter(isAutomationReportContrast)
    expect(values.filter(value => value.theme === 'dark')).toHaveLength(automationReportContrastPairs.length)
    for (const value of values.filter(value => value.theme === 'dark')) expect(value.ratio, value.id).toBeGreaterThanOrEqual(value.minimum)
    expect(values.filter(value => value.theme === 'light' && value.ratio < value.minimum).map(value => [value.id, Number(value.ratio.toFixed(3)), value.minimum])).toEqual(deficits)
  })
  it('la guardia cubre todas las fuentes del cromo y rechaza nuevas infracciones en cada una', () => {
    expect(auditThemeColors()).toEqual([])
    for (const file of files) {
      expect(migratedThemeFiles).toContain(file)
      expect(auditThemeSource(file, '<div class="bg-white text-slate-500" style="color:#fff"/>')).toHaveLength(3)
    }
  })
  it('conserva byte a byte Page, Sheet y Preview, y el aislamiento de rutas de salida', () => {
    for (const [file, sha] of Object.entries(paper)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(sha)
    for (const file of ['pages/registros/[entity]/reportes/vista-previa.vue', 'pages/registros/[entity]/reportes/[id]/imprimir.vue']) {
      const source = readFileSync(file, 'utf8'); expect(source).not.toContain('darkReady: true')
      expect(source).toContain('layout: false')
    }
    expect(contentNeedsLight({ layout: false, darkReady: true })).toBe(true)
  })
  it('las excepciones del documento son literales acotados: ninguna aparición adicional se admite', () => {
    for (const file of ['components/PrintReportSheet.vue', 'components/PrintReportPreview.vue']) {
      expect(migratedThemeFiles).toContain(file)
      const source = readFileSync(file, 'utf8')
      expect(auditThemeSource(file, source)).toEqual([])
      for (const literal of Object.keys(themeColorExceptions[file]!)) expect(auditThemeSource(file, source + `\n<style>.extra{color:${literal}}</style>`), `${file}:${literal}`).toHaveLength(1)
    }
  })
  it('Tailwind compila las sombras y colores con sus alfas exactos sin literales restantes', async () => {
    const require = createRequire(import.meta.url)
    const postcss = require('postcss'), tailwind = require('tailwindcss')
    const { brandColors } = await import('../../utils/themeTokens')
    const result = await postcss([tailwind({ content: [{ raw: files.map(file => readFileSync(file, 'utf8')).join('\n') }], theme: { extend: { colors: { brand: brandColors } } } })]).process('@tailwind utilities;', { from: undefined })
    expect(result.css).toContain('rgb(var(--brand-shadow)/0.0784313725490196)')
    expect(result.css).toContain('rgb(var(--brand-shadow)/0.2)')
    expect(result.css).toContain('rgb(var(--brand-shadow)/0.1411764705882353)')
    expect(result.css).toContain('rgb(var(--brand-report-picker-bg)')
    expect(result.css).not.toContain('<alpha-value>')
  })
})

describe.each(['light', 'dark'] as const)('montajes sin red, %s', mode => {
  it.each(files.slice(0, 5))('ruta completa con metadata temática: %s', async file => {
    const { host, meta } = await mount(file, mode)
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ darkReady: true }))
    expect(host.firstElementChild?.classList.contains('theme-light')).toBe(false)
    expect(contentNeedsLight(meta.mock.calls[0]![0])).toBe(false)
  })
  it('listado: estados explícitos, posición del switch, crear y rollback con error/toast', async () => {
    const fetch = vi.fn(async () => { throw new Error('Fallo simulado') })
    const { host, toast } = await mount(files[0]!, mode, {}, { fetch })
    for (const label of ['Éxito', 'Fallido', 'Reintentando', 'Agotado']) expect(host.textContent).toContain(label)
    const toggle = host.querySelector<HTMLButtonElement>('[role=switch]')!
    expect(toggle.getAttribute('aria-checked')).toBe('true'); toggle.click(); await flush()
    expect(toggle.getAttribute('aria-checked')).toBe('true'); expect(toast.error).toHaveBeenCalled()
    await click(host, 'Nueva automatización')
    expect(host.querySelector('#trigger-name')).toBeTruthy()
    expect(button(host, 'Crear automatización').disabled).toBe(true)
  })
  it.each(['empty', 'loading', 'error'] as const)('listado: %s', async state => {
    const { host } = await mount(files[0]!, mode, {}, { [state]: true })
    expect(host.textContent).toContain(state === 'empty' ? 'Aún no hay automatizaciones' : state === 'loading' ? 'Cargando' : 'No se pudo cargar')
  })
  it('creación: nombre y evento se envían sin alterar el contrato ni usar servicios reales', async () => {
    const { host, fetch, push, toast } = await mount(files[0]!, mode, {}, { empty: true })
    await click(host, 'Crear la primera automatización')
    const input = host.querySelector<HTMLInputElement>('#trigger-name')!
    input.value = 'Avisar'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    await click(host, 'Crear automatización')
    expect(fetch).toHaveBeenCalledWith('/api/triggers', { method: 'POST', body: { name: 'Avisar', entityId: 'e', triggerEvent: 'on_create' } })
    expect(push).toHaveBeenCalledWith('/triggers/nuevo/editar'); expect(toast.success).toHaveBeenCalled()
  })
  it('editor: selección, condiciones, acciones, historial y POST de reintento conservados', async () => {
    const { host, fetch, toast } = await mount(files[1]!, mode)
    expect(host.textContent).toContain('Activa'); expect(host.textContent).toContain('Sí cumple'); expect(host.textContent).toContain('No cumple')
    await click(host, 'Condiciones de entrada')
    expect(host.querySelector('.trunk-node.selected')).toBeTruthy()
    expect(host.querySelector('.condition-row')).toBeTruthy()
    host.querySelector<HTMLButtonElement>('.decision-node')!.click(); await flush()
    expect(host.textContent).toContain('Comparación')
    await click(host, 'Acción 1')
    expect(host.textContent).toContain('URL de destino')
    await click(host, 'Historial')
    for (const label of ['Éxito', 'Fallido', 'Reintentando', 'Agotado']) expect(host.textContent).toContain(label)
    await click(host, 'Reintentar')
    expect(fetch).toHaveBeenCalledWith('/api/trigger-logs/l1/retry', { method: 'POST' })
    expect(toast.success).toHaveBeenCalledWith('Reintento enviado', expect.any(String))
  })
  it('editor: preview simulado, guardado y error de reintento sin acciones reales', async () => {
    const { host, fetch, toast } = await mount(files[1]!, mode)
    await click(host, 'Probar flujo'); await click(host, 'Simular recorrido')
    expect(host.textContent).toContain('No se ejecutó ninguna acción')
    expect(fetch).toHaveBeenCalledWith('/api/trigger-preview', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ triggerId: 't' }) }))
    await click(host, 'Guardar cambios')
    expect(fetch).toHaveBeenCalledWith('/api/triggers/t', expect.objectContaining({ method: 'PUT' }))
    fetch.mockRejectedValueOnce(new Error('Fallo simulado'))
    await click(host, 'Historial'); await click(host, 'Reintentar')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('No se pudo reintentar')
    expect(toast.error).toHaveBeenCalled()
  })
  it('nodo de acción: estados y emisiones de selección/movimiento/eliminación', async () => {
    const select = vi.fn(), move = vi.fn(), remove = vi.fn()
    const { host } = await mount('components/WorkflowActionNode.vue', mode, { title: 'Acción', summary: 'Notificar', actionType: 'notification', selected: true, negative: true, first: true, onSelect: select, onMove: move, onRemove: remove })
    expect(host.querySelector('.workflow-action.selected.negative')).toBeTruthy()
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Mover acción arriba"]')!.disabled).toBe(true)
    host.querySelector<HTMLButtonElement>('[aria-label="Mover acción abajo"]')!.click()
    host.querySelector<HTMLButtonElement>('[aria-label="Eliminar acción"]')!.click()
    host.querySelector<HTMLButtonElement>('[aria-label="Editar acción"]')!.click()
    expect(move).toHaveBeenCalledWith(1); expect(remove).toHaveBeenCalled(); expect(select).toHaveBeenCalled()
  })
  it('constructor de condiciones, valor booleano y configuración upsert montados', async () => {
    const update = vi.fn()
    const condition = await mount('components/WorkflowConditionRows.vue', mode, { fields: [field], event: 'on_update', modelValue: [{ field: 'nombre', operator: 'changed', value: '' }], 'onUpdate:modelValue': update })
    expect(condition.host.textContent).toContain('Compara el valor anterior')
    await click(condition.host, 'Agregar condición'); expect(update).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ operator: 'eq' })]))
    const value = await mount('components/WorkflowFieldValue.vue', mode, { modelValue: 'false', dataType: 'boolean', label: 'Activo', 'onUpdate:modelValue': update })
    expect(value.host.textContent).toContain('Sí')
    const upsert = await mount('components/WorkflowUpsertRecordConfig.vue', mode, { modelValue: {}, sourceEntityId: 'origen', sourceFields: [field] })
    expect(upsert.host.textContent).toContain('Módulo destino')
  })
  it('reporte IA: tabla temática y generación/guardado con respuestas locales', async () => {
    const { host, fetch, toast } = await mount(files[2]!, mode)
    const input = host.querySelector('textarea')!
    input.value = 'Clientes'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    await click(host, 'Generar previsualización')
    expect(host.querySelector('table')?.textContent).toContain('Ana')
    expect(host.querySelector('.theme-light')).toBeNull()
    await click(host, 'Guardar reporte'); expect(fetch).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'POST' })); expect(toast.success).toHaveBeenCalled()
  })
  it('diseñador: papel claro local, campos/selección/arrastre, zoom, filtros y guardado', async () => {
    const { host, fetch, toast } = await mount('components/PrintReportDesigner.vue', mode, { entitySlug: 'clientes', initialDsl: dsl })
    const page = host.querySelector('.report-design-paper')!
    expect(page.classList.contains('theme-light')).toBe(true); expect(host.querySelectorAll('.theme-light')).toHaveLength(1)
    expect(host.firstElementChild?.classList.contains('theme-light')).toBe(false)
    await click(host, 'Acercar lienzo')
    expect(page.getAttribute('style')).toContain('zoom: 1.25')
    host.querySelector<HTMLButtonElement>('[aria-label="Columna Nombre"]')!.click(); await flush()
    expect(host.textContent).toContain('Quitar columna')
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: (type: string) => type === 'application/json' ? JSON.stringify({ side: 'base', forwardHops: [], field: 'nombre', label: 'Nombre', dataType: 'text' }) : '' } })
    page.parentElement!.dispatchEvent(drop); await flush()
    expect(host.querySelectorAll('[aria-label="Columna Nombre"]')).toHaveLength(2)
    await click(host, 'Filtros'); await click(host, 'Agregar filtro'); expect(host.textContent).toContain('Etiqueta visible')
    await click(host, 'Guardar reporte')
    expect(fetch).toHaveBeenCalledWith('/api/print-reports', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ title: 'Clientes' }) }))
    expect(toast.success).toHaveBeenCalled()
  })
  it.each(['loading', 'error'] as const)('diseñador: árbol en %s con controles conservados', async state => {
    const { host } = await mount('components/PrintReportDesigner.vue', mode, { entitySlug: 'clientes' }, { [state]: true })
    expect(host.textContent).toContain(state === 'loading' ? 'Cargando campos' : 'No se pudieron cargar los campos')
    expect(host.querySelector('.report-design-paper.theme-light')).toBeTruthy()
  })
  it('diseñador: conserva selección y papel al alternar tema; datos/error con preview local', async () => {
    measurements()
    const { host, fetch } = await mount('components/PrintReportDesigner.vue', mode, { entitySlug: 'clientes', initialDsl: dsl })
    const page = host.querySelector('.report-design-paper')!, column = host.querySelector<HTMLButtonElement>('[aria-label="Columna Nombre"]')!
    column.click(); await flush(); const markup = page.outerHTML
    theme(mode === 'light' ? 'dark' : 'light'); await flush()
    expect(host.querySelector('.report-design-paper')).toBe(page); expect(page.outerHTML).toBe(markup)
    expect(column.classList.contains('bg-brand-blue-bg')).toBe(true)
    await click(host, 'Probar con datos')
    expect(host.querySelector('.report-sheets.theme-light')).toBeTruthy(); expect(fetch).toHaveBeenCalledWith('/api/print-reports/preview', expect.objectContaining({ method: 'POST' }))
    fetch.mockRejectedValueOnce(new Error('Fallo simulado')); await click(host, 'Probar con datos')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('No se pudieron cargar los datos')
  })
  it('árbol: ramas, etiquetas de tipo, hojas y payload de drag conservados', async () => {
    const select = vi.fn()
    const branch: reports.FieldTreeBranch = { type: 'branch', kind: 'forward', fieldName: 'cliente', entitySlug: 'clientes', entityName: 'Cliente', cardinality: '1:1', children: [leaf] }
    const { host } = await mount('components/PrintReportFieldTree.vue', mode, { nodes: [branch], 'onSelect-leaf': select })
    await click(host, 'Cliente'); await click(host, 'Nombre')
    expect(host.textContent).toContain('Texto'); expect(select).toHaveBeenCalledWith(expect.objectContaining({ forwardHops: ['cliente'], field: 'nombre' }))
    const transfer = { setData: vi.fn(), effectAllowed: '' }, drag = new Event('dragstart')
    Object.defineProperty(drag, 'dataTransfer', { value: transfer }); host.querySelector('[draggable=true]')!.dispatchEvent(drag)
    expect(transfer.setData).toHaveBeenCalledWith('application/json', expect.stringContaining('nombre'))
  })
  it('picker: búsqueda y selección teletransportada; hereda aislamiento claro del origen', async () => {
    const update = vi.fn()
    const { host } = await mount('components/PrintReportFieldPicker.vue', mode, { modelValue: '', ariaLabel: 'Campo', options: [{ value: 'nombre', label: 'Clientes › Nombre' }], 'onUpdate:modelValue': update }, { lightScope: true })
    host.querySelector('button')!.click(); await flush()
    const panel = document.querySelector('[role=listbox]')!.parentElement!
    expect(panel.classList.contains('theme-light')).toBe(true)
    const input = panel.querySelector('input')!; input.value = 'nombre'; input.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    panel.querySelector<HTMLButtonElement>('[role=option]')!.click(); await flush()
    expect(update).toHaveBeenCalledWith('nombre')
  })
  it('opciones/layout: menú real, marca de seleccionado y controles montados', async () => {
    const update = vi.fn()
    const { host } = await mount('components/PrintReportLayoutControls.vue', mode, { modelValue: layout.resolvePrintLayout(), 'onUpdate:modelValue': update })
    await click(host, 'Carta'); await click(host, 'A4')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ paper: 'a4' }))
    const filter = await mount('components/PrintReportFilterSelect.vue', mode, { label: 'Cliente', modelValue: 'ana', options: [{ value: 'ana', label: 'Ana' }] })
    await click(filter.host, 'Ana'); expect(filter.host.querySelector('[aria-selected=true] svg')).toBeTruthy()
  })
  it('selector de filtros: loading/error/vacío y disabled con mensajes explícitos', async () => {
    const loading = await mount('components/PrintReportFilterSelect.vue', mode, { label: 'Cliente', options: [], pending: true })
    await click(loading.host, 'Cargando opciones'); expect(loading.host.querySelector('[role=status]')).toBeTruthy()
    const error = await mount('components/PrintReportFilterSelect.vue', mode, { label: 'Cliente', options: [], error: 'Error simulado' })
    await click(error.host, 'Selecciona una opción'); expect(error.host.querySelector('[role=alert]')?.textContent).toBe('Error simulado')
    const disabled = await mount('components/PrintReportFilterSelect.vue', mode, { label: 'Cliente', options: [], disabled: true })
    expect(disabled.host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
  })
  it('modal de parámetros: requeridos, disabled, switch y generación local', async () => {
    measurements(); const generate = vi.fn()
    const param: parameters.ReportParameter = { id: 'activo', source, label: 'Activo', input: 'toggle', required: true }
    const { host } = await mount('components/PrintReportParameterModal.vue', mode, { dsl: { ...dsl, parameters: [param] }, onGenerate: generate })
    const toggle = host.querySelector<HTMLButtonElement>('[role=switch]')!
    expect(toggle.getAttribute('aria-checked')).toBe('false'); toggle.click(); await flush()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(generate).toHaveBeenCalledWith({ activo: { operator: 'eq', value: 'true' } })
  })
  it('modal: filtro opcional deshabilitado y error requerido conservados', async () => {
    measurements()
    const { host } = await mount('components/PrintReportParameterModal.vue', mode, { dsl: { ...dsl, parameters: [{ id: 'opcional', source, label: 'Opcional', input: 'text', required: false }, { id: 'nombre', source, label: 'Nombre', input: 'text', required: true }] } })
    expect(host.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Completa Nombre')
  })
  it('Page, Sheet y Preview reales: papel blanco, tinta/márgenes idénticos al alternar tema', async () => {
    measurements()
    style(readFileSync('assets/css/theme.css', 'utf8'))
    style(parse(readFileSync('components/PrintReportSheet.vue', 'utf8')).descriptor.styles.map(block => block.content).join('\n'))
    const { host } = await mount('components/PrintReportPreview.vue', mode, { title: 'Clientes', result, loading: false, error: '', groupFieldLabels: [], generatedAt: new Date('2026-10-03T12:00:00Z') })
    const page = host.querySelector<HTMLElement>('.report-paper')!
    expect(page).toBeTruthy(); expect(page.closest('.theme-light')).toBeTruthy()
    const snapshot = () => {
      const computed = getComputedStyle(page), heading = getComputedStyle(page.querySelector('.report-company-name')!)
      return { background: computed.backgroundColor, padding: computed.padding, shadow: computed.boxShadow, font: computed.fontFamily, scheme: computed.colorScheme, heading: heading.color, html: page.innerHTML }
    }
    const before = snapshot(); expect(before.background).toBe('rgb(255, 255, 255)'); expect(before.padding).toBe('12mm'); expect(before.heading).toBe('rgb(26, 26, 26)'); expect(before.scheme).toBe('light')
    theme(mode === 'light' ? 'dark' : 'light'); await flush()
    expect(host.querySelector('.report-paper')).toBe(page); expect(snapshot()).toEqual(before)
    expect(createHash('sha256').update(JSON.stringify(snapshot())).digest('hex')).toBe(createHash('sha256').update(JSON.stringify(before)).digest('hex'))
  })
})
