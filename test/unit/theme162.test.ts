// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, ref, Suspense, useId, watch, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { auditThemeColors, auditThemeSource, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { darkTokens, lightTokens } from '../../utils/themeTokens'
import * as calendar from '../../utils/calendar'
import * as validation from '../../utils/validateFieldValue'
import * as fieldValue from '../../utils/fieldValue'
import * as recordText from '../../utils/recordText'
import { colorDotClass, colorBadgeClasses } from '../../utils/optionColors'
import type { EntityFieldMeta } from '../../composables/useEntityFields'

const apps: App[] = []
const toast = { error: vi.fn(), updated: vi.fn() }
const globals = { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useId, useToast: () => toast, useConfirm: () => ({ confirm: vi.fn(async () => true) }), navigateTo: vi.fn() }
async function mount(component: Component, props: Record<string, unknown>, theme: string) {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, props) }) })
  Object.defineProperties(app.config.globalProperties, {
    colorDotClass: { value: colorDotClass },
    colorBadgeClasses: { value: colorBadgeClasses }
  })
  for (const name of ['DynamicFileValue', 'FieldDateValue', 'ReportOptionSelect', 'VariableTextField', 'DynamicSelectField', 'DynamicRelationField', 'DynamicTableField', 'DynamicUserField', 'DynamicFileField']) app.component(name, { render: () => h('span') })
  app.mount(host); apps.push(app)
  await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  expect(host.querySelector('.theme-light')).toBeNull()
  return host
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('contratos HU-162', () => {
  it('audita todos los archivos migrados y rechaza colores nuevos, incluso en estados y SVG', () => {
    expect(migratedThemeFiles.length).toBeGreaterThan(40)
    expect(auditThemeColors()).toEqual([])
    for (const color of ['bg-white', 'text-black', 'hover:bg-red-500', 'focus:border-slate-300', 'fill-blue-600', 'color:#abcdef', 'background:rgb(1,2,3)', 'background:white']) {
      expect(auditThemeSource('components/RecordCalendar.vue', color), color).toHaveLength(1)
    }
    expect(auditThemeSource('app.vue', '#33475b1f #33475b1f')).toHaveLength(1)
    expect(auditThemeSource('test.vue', 'rgb(var(--brand-text)) #add-validation')).toEqual([])
  })
  it('congela los hex claros nuevos, define sus oscuros y no confunde columna con tarjeta', () => {
    const originals = { 'kanban-column': '#EEF2F7', 'kanban-focus': '#8FC8D4', 'kanban-divider': '#EDF1F5', 'stage-cyan': '#00A4BD', 'stage-purple': '#6A5ACD', 'mention-hover': '#007A91', 'activity-error': '#B42318', 'origin-border': '#DBE8EC', 'origin-bg': '#F5FAFB', 'app-pending-text': '#B45309', 'app-pending-dot': '#D97706', 'modal-overlay': '#000000' } as const
    for (const [name, value] of Object.entries(originals)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(value)
      expect(darkTokens[name as keyof typeof darkTokens]).toMatch(/^#[\dA-F]{6}$/)
    }
    expect(darkTokens['kanban-column']).not.toBe(darkTokens.surface)
  })
  it('habilita nuevo/editar, retira los tres aislamientos y conserva las rutas ajenas', () => {
    for (const file of ['pages/registros/[entity]/nuevo.vue', 'pages/registros/[entity]/[id]/editar.vue']) {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('darkReady: true'); expect(source).not.toContain('theme-light')
    }
    const index = readFileSync('pages/registros/[entity]/index.vue', 'utf8')
    expect(index).not.toContain('class="theme-light"')
    expect(readFileSync('components/RecordDetailView.vue', 'utf8')).not.toContain('<ActivityTimeline class="theme-light"')
    // HU-164 migra módulos/catálogos; el diseñador de IA conserva protección.
    expect(readFileSync('pages/disenador.vue', 'utf8')).not.toContain('darkReady: true')
    expect(readFileSync('components/PrintReportPage.vue', 'utf8')).toContain('theme-light')
  })
  it('usa los canales globales en calendario y el esquema nativo heredado', () => {
    const source = readFileSync('components/RecordCalendar.vue', 'utf8')
    expect(source).not.toContain('--calendar-'); expect(source).not.toContain(':global(.dark)')
    expect(source).toContain('rgb(var(--brand-surface))')
    expect(readFileSync('components/DynamicForm.vue', 'utf8')).toContain('color-scheme:inherit')
    expect(readFileSync('components/RecordKanbanBoard.vue', 'utf8')).toContain('.mobile-status option{background:rgb(var(--brand-surface))')
    const css = readFileSync('assets/css/theme.css', 'utf8')
    expect(css).toContain('color-scheme: dark'); expect(css).toContain('color-scheme: light !important')
  })
  it('adapta el Tablero al contenedor reducido por Chattito', () => {
    const source = readFileSync('pages/index.vue', 'utf8')
    expect(source).toContain('container-type:inline-size')
    expect(source).toContain('@container (max-width: 1000px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-columns{grid-template-columns:1fr}')
    expect(source).toContain('.panel{min-width:0;')
  })
})

describe.each(['light', 'dark'])('montajes reales sin red, tema %s', theme => {
  it.each(['select', 'multiselect'])('campo %s mantiene opciones, chips y selección', async type => {
    const component = compileVueComponent('components/DynamicSelectField.vue', {}, { ...globals, colorDotClass, colorBadgeClasses })
    const update = vi.fn()
    const host = await mount(component, { field: { id: 'estado', name: 'estado', label: 'Estado', dataType: type, validationRules: { options: [{ value: 'ok', label: 'Ganada', color: 'success' }] } }, modelValue: type === 'select' ? '' : ['ok'], 'onUpdate:modelValue': update }, theme)
    if (type === 'multiselect') expect(host.querySelector('.bg-brand-success-bg')).not.toBeNull()
    ;(host.querySelector('button') as HTMLButtonElement).click(); await nextTick()
    const option = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Ganada')!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await nextTick()
    expect(update).toHaveBeenCalledWith(type === 'select' ? 'ok' : [])
  })
  it('campo usuario conserva búsqueda y selección con lookup simulado', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/me') ? { id: 'u' } : { users: [{ id: 'u', fullName: 'Ana', email: 'ana@local', isActive: true, roleId: null, roleName: 'Equipo' }] }))
    const component = compileVueComponent('components/DynamicUserField.vue', {}, { ...globals, useRoute: () => ({ path: '/registros/citas/nuevo' }) })
    const update = vi.fn()
    const host = await mount(component, { field: { name: 'usuario', validationRules: {} }, modelValue: null, 'onUpdate:modelValue': update }, theme)
    const input = host.querySelector<HTMLInputElement>('input')!; input.value = 'Ana'; input.dispatchEvent(new Event('input')); await nextTick()
    expect(input.classList.contains('bg-brand-surface')).toBe(true)
    ;(host.querySelector('button') as HTMLButtonElement).click(); expect(update).toHaveBeenCalledWith('u')
  })
  it('campo archivo conserva captura y estado deshabilitado sin subir archivos', async () => {
    const component = compileVueComponent('components/DynamicFileField.vue', {}, globals)
    const host = await mount(component, { field: { name: 'archivo', validationRules: {} }, entityId: 'citas', modelValue: null, disabled: true }, theme)
    expect(host.querySelector<HTMLInputElement>('[type="file"]')?.disabled).toBe(true)
    expect(host.querySelector('label')?.classList.contains('pointer-events-none')).toBe(true)
  })
  it('campo tabla conserva editor de filas y cálculo de subtotal', async () => {
    const component = compileVueComponent('components/DynamicTableField.vue', {}, globals)
    const update = vi.fn()
    const host = await mount(component, { field: { name: 'partidas', validationRules: { columns: [{ name: 'cantidad', label: 'Cantidad', type: 'number' }, { name: 'precio', label: 'Precio', type: 'number' }, { name: 'subtotal', label: 'Subtotal', type: 'number', readonly: true }] } }, modelValue: [{ cantidad: 2, precio: 10, subtotal: 20 }], 'onUpdate:modelValue': update }, theme)
    const input = host.querySelector<HTMLInputElement>('[type="number"]')!; input.value = '3'; input.dispatchEvent(new Event('input'))
    expect(update).toHaveBeenCalledWith([{ cantidad: 3, precio: 10, subtotal: 30 }])
    expect(host.querySelector('table')).not.toBeNull()
  })
  it('Kanban conserva carga por columna, colores y actualización optimista con rollback', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('sin red'))
    vi.stubGlobal('$fetch', fetcher)
    const board = compileVueComponent('components/RecordKanbanBoard.vue', {}, globals)
    const host = await mount(board, {
      entitySlug: 'citas', config: { statusField: 'estado', titleField: 'titulo', secondaryFields: [] }, fields: [], canUpdate: true,
      columns: [{ key: 'nuevo', label: 'Nuevo', color: 'blue', total: 2, records: [{ id: 'a', customData: { titulo: 'Cita' }, updatedAt: '2026-10-02T12:00:00Z' }] }, { key: 'ganado', label: 'Ganado', color: 'success', total: 0, records: [] }]
    }, theme)
    expect(host.querySelector('.status-mark')?.getAttribute('style')).toContain('--brand-blue')
    expect(host.querySelectorAll('.column-empty')).toHaveLength(1)
    const select = host.querySelector('select')!; select.value = 'ganado'; select.dispatchEvent(new Event('change'))
    await nextTick(); await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetcher).toHaveBeenCalledWith('/api/records/citas/a', expect.objectContaining({ method: 'PATCH' }))
    expect(host.querySelectorAll('.kanban-column')[0]!.textContent).toContain('Cita')
    expect(toast.error).toHaveBeenCalled()
    ;(host.querySelector('.column-more') as HTMLButtonElement).click(); await nextTick()
    expect(fetcher).toHaveBeenCalledWith('/api/records/citas/board', expect.objectContaining({ query: expect.objectContaining({ offset: 1 }) }))
  })
  it('Calendario conserva más eventos, cambio de vista y creación', async () => {
    const component = compileVueComponent('components/RecordCalendar.vue', { '~/utils/calendar': calendar }, globals)
    const date = calendar.localDateKey(new Date())
    const create = vi.fn()
    const host = await mount(component, { entitySlug: 'citas', entityName: 'Citas', config: { defaultView: 'month' }, fields: [], timezone: 'America/Mexico_City', canUpdate: true, assignedToMe: false,
      events: Array.from({ length: 4 }, (_, i) => ({ id: String(i), date, time: '09:00', title: 'Cita', durationMinutes: 30, color: null, groupValue: '', groupLabel: '', customData: {}, updatedAt: '' })), onCreateRecord: create
    }, theme)
    expect(host.querySelector('.calendar-month-event')?.getAttribute('style')).toContain('--brand-blue')
    expect(host.querySelector('.calendar-more')?.textContent).toContain('+1 más')
    ;(host.querySelector('.calendar-add') as HTMLButtonElement).click(); expect(create).toHaveBeenCalled()
    ;(host.querySelector('.calendar-more') as HTMLButtonElement).click(); await nextTick()
    expect(host.querySelector('.calendar-time-view')).not.toBeNull()
  })
  it('Timeline conserva cambios, fechas exactas, vacío y carga', async () => {
    const data = ref<unknown[]>([{ id: 'a', actionType: 'UPDATED', createdAt: '2026-10-02T12:00:00Z', user: { name: 'Ana' }, details: { changes: [{ field: 'titulo', old: 'Antes', new: 'Después' }] } }])
    const pending = ref(false)
    const selector = compileVueComponent('components/ReportOptionSelect.vue', {}, globals)
    const component = compileVueComponent('components/ActivityTimeline.vue', { '~/utils/recordText': recordText, '~/components/ReportOptionSelect.vue': { default: selector } }, { ...globals, useState: (_key: string, init: () => number) => ref(init()), useFetch: async () => ({ data, pending, error: ref(null), refresh: vi.fn() }) })
    const host = await mount(component, { entity: 'citas', recordId: 'a', fields: [], canUpdate: false, compact: true }, theme)
    expect(host.querySelector('.old-value')?.textContent).toBe('Antes')
    expect(host.querySelector('.change-row strong')?.textContent).toBe('Después')
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-02T12:00:00Z')
    data.value = []; await nextTick(); expect(host.querySelector('.activity-empty')).not.toBeNull()
    pending.value = true; await nextTick(); expect(host.querySelector('[role="status"]')).not.toBeNull()
  })
  it('DynamicForm conserva validación, fecha, números, booleano y JSON', async () => {
    const fields = ['text', 'number', 'date', 'boolean', 'json', 'incremental'].map(type => ({ id: type, name: type, label: type, dataType: type, isRequired: type === 'text', validationRules: {} })) as EntityFieldMeta[]
    const model = ref<Record<string, unknown>>({ date: '2026-10-02', number: 12, json: '{}', boolean: true })
    const instance = ref<{ validateAll: () => boolean }>()
    const component = compileVueComponent('components/DynamicForm.vue', { '~/utils/validateFieldValue': validation, '~/utils/fieldValue': fieldValue }, { ref, computed, validateFieldValue: validation.validateFieldValue })
    const host = await mount(component, { ref: instance, fields, entityId: 'citas', modelValue: model.value, 'onUpdate:modelValue': (value: Record<string, unknown>) => { model.value = value } }, theme)
    expect(host.querySelector<HTMLInputElement>('[type="date"]')?.value).toBe('2026-10-02')
    expect(host.querySelector<HTMLInputElement>('[type="checkbox"]')?.checked).toBe(true)
    expect(host.querySelector('#field-incremental')).toBeNull()
    expect(instance.value!.validateAll()).toBe(false); await nextTick()
    expect(host.querySelector('.text-brand-error-text')).not.toBeNull()
    const number = host.querySelector<HTMLInputElement>('[type="number"]')!; number.value = '25'; number.dispatchEvent(new Event('input'))
    expect(model.value.number).toBe(25)
    expect(host.querySelector('#field-text')?.classList.contains('bg-brand-surface')).toBe(true)
  })
})
