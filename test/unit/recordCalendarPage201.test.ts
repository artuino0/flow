// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as calendar from '../../utils/calendar'
import * as listFilters from '../../utils/listFilters'
import * as relativeTime from '../../utils/relativeTime'

const apps: App[] = []
const flush = async () => { for (let index = 0; index < 24; index++) { await Promise.resolve(); await vue.nextTick() } }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks() })

function mountStandaloneCalendar(onCreate: (payload: { date: string; time: string }) => void = vi.fn(), events: Array<{ id: string; customData: Record<string, unknown>; updatedAt: string; date: string; time: string; durationMinutes: number; title: string; color: string | null; groupValue: string; groupLabel: string }> = []) {
  const config = { enabled: true, startDateField: 'fecha', startTimeField: 'hora', durationField: null, endField: null, titleField: 'fecha', colorField: null, groupByField: 'recurso', defaultView: 'day' as const }
  const component = compileVueComponent('components/RecordCalendar.vue', { '~/utils/calendar': calendar }, { ...vue, useToast: () => ({ error: vi.fn(), success: vi.fn() }) })
  const root = vue.defineComponent({ setup: () => () => vue.h(component, {
    entitySlug: 'agenda-citas', entityName: 'Citas', config, initialView: 'day', fields: [], events, timezone: 'UTC',
    canUpdate: true, assignedToMe: false, onCreateRecord: onCreate
  }) })
  const host = document.createElement('div')
  document.body.append(host)
  const app = vue.createApp(root)
  app.mount(host)
  apps.push(app)
  return { host, app }
}

function mountCalendarPage(options: { createHandler?: () => Promise<{ id?: string; customData?: { _agenda_conflict?: boolean } }>; confirmHandler?: () => Promise<boolean> } = {}) {
  const config = { enabled: true, startDateField: 'fecha', startTimeField: null, durationField: null, endField: null, titleField: 'fecha', colorField: null, groupByField: null, defaultView: 'day' as const }
  const meta = vue.ref({
    entity: { id: 'agenda-citas', slug: 'agenda-citas', name: 'Citas', workflowConfig: null, labelConfig: null },
    fields: [{ id: 'fecha', name: 'fecha', label: 'Fecha', dataType: 'date', validationRules: {}, isRequired: false }],
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
    inverseRelations: [], detailLayout: { properties: [], relations: [], showActivity: false },
    listLayout: { columns: [{ name: 'fecha', visible: true }], filterFields: [], defaultSort: null },
    boardConfig: { enabled: false, statusField: null, titleField: null, secondaryFields: [], defaultView: 'table' as const },
    calendarConfig: config
  })
  const requests: Array<{ from: string; to: string }> = []
  const calendarPending = vue.ref(false)
  const calendarData = vue.ref({ config, events: [], relationLabels: {}, timezone: 'America/Mexico_City' })
  const refreshCalendar = vi.fn()
  const fetchCreate = vi.fn(options.createHandler ?? (async () => ({ id: 'created-record' })))
  const confirm = vi.fn(options.confirmHandler ?? (async () => true))
  const toast = { error: vi.fn(), success: vi.fn(), updated: vi.fn() }
  const globals = {
    ...vue,
    definePageMeta: vi.fn(),
    useRoute: () => ({ params: { entity: 'agenda-citas' }, query: {} }),
    useAuth: () => ({ user: vue.ref({ roleId: 'role-citas' }) }),
    useEntityFields: async () => ({ data: meta, pending: vue.ref(false), error: vue.ref(null) }),
    useIsAdmin: async () => ({ data: vue.ref(false) }),
    useRequestHeaders: () => ({}),
    useToast: () => toast,
    useConfirm: () => ({ confirm }),
    $fetch: fetchCreate,
    navigateTo: vi.fn(),
    useFetch: async (url: string, options: { query?: vue.ComputedRef<Record<string, unknown>> } = {}) => {
      if (url.endsWith('/calendar')) {
        const query = options.query!
        requests.push({ from: String(query.value.from), to: String(query.value.to) })
        vue.watch(query, value => {
          requests.push({ from: String(value.from), to: String(value.to) })
          calendarPending.value = true
        })
        return { data: calendarData, pending: calendarPending, error: vue.ref(null), refresh: refreshCalendar }
      }
      const data = url.endsWith('/board')
        ? vue.ref(null)
        : vue.ref({ data: [], page: 1, pageSize: 20, total: 0, relationLabels: {} })
      return { data, pending: vue.ref(false), error: vue.ref(null), refresh: vi.fn() }
    }
  }
  const childGlobals = { ...vue, useToast: globals.useToast }
  const recordCalendar = compileVueComponent('components/RecordCalendar.vue', { '~/utils/calendar': calendar }, childGlobals)
  const recordCreateForm = compileVueComponent('components/RecordCreateForm.vue', { '@lucide/vue': { Clock: { render: () => null } } }, globals)
  const page = compileVueComponent('pages/registros/[entity]/index.vue', {
    '~/utils/calendar': calendar,
    '~/utils/listFilters': listFilters,
    '~/utils/relativeTime': relativeTime
  }, globals)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, null, { default: () => vue.h(page) }) })
  app.component('RecordCalendar', recordCalendar)
  app.component('RecordCreateForm', recordCreateForm)
  app.component('DynamicForm', vue.defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (props, { emit, expose }) => { expose({ validateAll: () => true }); return () => vue.h('input', { value: (props.modelValue as Record<string, unknown>)?.fecha ?? '', onInput: (event: Event) => emit('update:modelValue', { ...props.modelValue, fecha: (event.target as HTMLInputElement).value }) }) } }))
  app.component('AgendaConflictOverride', { render: () => null })
  app.component('NuxtLink', vue.defineComponent({ props: ['to'], setup: (props, { slots }) => () => vue.h('a', { href: typeof props.to === 'string' ? props.to : props.to?.path }, slots.default?.()) }))
  app.component('RecordKanbanBoard', { render: () => null })
  app.component('DynamicTable', { render: () => null })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  apps.push(app)
  return { app, host, requests, calendarPending, calendarData, refreshCalendar, fetchCreate, toast, confirm }
}

it('abre el panel desde el hueco con la fecha y hora seleccionadas, y al guardar refresca sin salir del calendario', async () => {
  const { host, refreshCalendar, fetchCreate } = mountCalendarPage()
  await flush()
  const slot = [...host.querySelectorAll<HTMLButtonElement>('.calendar-time-slot button')].find(button => button.getAttribute('aria-label')?.includes('10:00'))
  expect(slot).toBeTruthy()
  slot!.click()
  await flush()
  const dialog = document.body.querySelector('[role="dialog"]')
  expect(dialog).toBeTruthy()
  expect(dialog?.textContent).toContain(host.querySelector('.calendar-mobile-day strong')?.textContent)
  expect(dialog?.textContent).toContain('10:00')
  expect(dialog?.querySelector('a')?.getAttribute('href')).toContain('/registros/agenda-citas/nuevo')
  ;(dialog?.querySelector('button[type="submit"]') as HTMLButtonElement).click()
  await flush()
  expect(fetchCreate).toHaveBeenCalledWith('/api/records/agenda-citas', expect.objectContaining({ method: 'POST' }))
  expect(refreshCalendar).toHaveBeenCalledOnce()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(host.querySelector('.calendar-views button.active')?.textContent).toBe('Día')
})

it('mantiene abierto el panel y conserva los campos si el servidor responde con conflicto de agenda', async () => {
  const { host, fetchCreate, toast } = mountCalendarPage({ createHandler: async () => { throw { statusCode: 409, data: { statusMessage: 'Hueco ya ocupado' } } } })
  await flush()
  ;([...host.querySelectorAll<HTMLButtonElement>('.calendar-time-slot button')].find(button => button.getAttribute('aria-label')?.includes('10:00')) as HTMLButtonElement).click()
  await flush()
  const dialog = document.body.querySelector('[role="dialog"]')!
  const input = dialog.querySelector('input')!
  input.value = '2026-10-07'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
  ;(dialog.querySelector('button[type="submit"]') as HTMLButtonElement).click()
  await flush()
  expect(fetchCreate).toHaveBeenCalledOnce()
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Hueco ya ocupado')
  expect((dialog.querySelector('input') as HTMLInputElement).value).toBe('2026-10-07')
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
  expect(toast.error).toHaveBeenCalledOnce()
})

it('atrapa el foco, pide confirmación por Escape con cambios y restaura el foco al calendario', async () => {
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const { host } = mountCalendarPage({ confirmHandler: confirm })
  await flush()
  const slot = [...host.querySelectorAll<HTMLButtonElement>('.calendar-time-slot button')].find(button => button.getAttribute('aria-label')?.includes('10:00'))!
  slot.focus()
  slot.click()
  await flush()
  const dialog = document.body.querySelector('[role="dialog"]')!
  const input = dialog.querySelector('input')!
  expect(dialog.contains(document.activeElement)).toBe(true)
  input.value = 'cambio'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()
  expect(confirm).toHaveBeenCalledOnce()
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(slot)
})

it('recuerda Semana al remontar y consulta el rango semanal actual con una sola actualización extra como máximo', async () => {
  localStorage.setItem('flow-record-calendar-view:agenda-citas', 'week')
  const first = mountCalendarPage()
  await flush()
  expect(first.host.querySelector('.calendar-views button.active')?.textContent).toBe('Semana')
  expect(first.requests.length).toBeLessThanOrEqual(2)
  const expectedRange = calendar.calendarRange(new Date(), 'week')
  expect(first.requests.at(-1)).toEqual(expectedRange)
  first.app.unmount()

  const remounted = mountCalendarPage()
  await flush()
  expect(remounted.host.querySelector('.calendar-views button.active')?.textContent).toBe('Semana')
  expect(remounted.requests.length).toBeLessThanOrEqual(2)
  expect(remounted.requests.at(-1)).toEqual(calendar.calendarRange(new Date(), 'week'))
})

it('ignora una vista de calendario inválida guardada y conserva la configuración', async () => {
  localStorage.setItem('flow-record-calendar-view:agenda-citas', 'year')
  const { host, requests } = mountCalendarPage()
  await flush()
  expect(host.querySelector('.calendar-views button.active')?.textContent).toBe('Día')
  expect(requests).toHaveLength(1)
  expect(requests[0]).toEqual(calendar.calendarRange(new Date(), 'day'))
})

it('alinea las 24 horas sin reservar una fila vacía y permite crear a las 20:00', async () => {
  const onCreate = vi.fn()
  const { host } = mountStandaloneCalendar(onCreate)
  await flush()
  expect(host.querySelectorAll('.calendar-hours span')).toHaveLength(24)
  expect(host.querySelectorAll('.calendar-time-slot')).toHaveLength(24)
  expect(host.querySelector('.calendar-hours span')?.textContent).toBe('00:00')
  expect(host.querySelectorAll('.calendar-hours span')[23].textContent).toBe('23:00')
  expect(host.querySelector('.calendar-resource-spacer')).toBeNull()
  expect(host.querySelector('.calendar-resource-heading')).toBeNull()
  ;([...host.querySelectorAll<HTMLButtonElement>('.calendar-time-slot button')].find(button => button.getAttribute('aria-label')?.includes('20:00')) as HTMLButtonElement).click()
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ time: '20:00' }))
  expect(calendar.calendarBlockPosition('20:00', 60, 0).top).toBe(20 * 64)
})

it('marca la hora actual del calendario, actualiza cada minuto y solo la muestra para hoy', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T12:34:00.000Z'))
  const { host } = mountStandaloneCalendar()
  await flush()
  expect(host.querySelectorAll('.calendar-current-time')).toHaveLength(1)
  const todayColumn = [...host.querySelectorAll('.calendar-day-column')].find(column => column.contains(host.querySelector('.calendar-current-time')))
  expect(todayColumn).toBeDefined()
  expect(Number.parseFloat((host.querySelector('.calendar-current-time') as HTMLElement).style.top)).toBeCloseTo((12 * 60 + 34) / 60 * 64)
  await vi.advanceTimersByTimeAsync(60_000)
  await flush()
  expect(Number.parseFloat((host.querySelector('.calendar-current-time') as HTMLElement).style.top)).toBeCloseTo((12 * 60 + 35) / 60 * 64)
  ;(host.querySelector('[aria-label="Periodo anterior"]') as HTMLButtonElement).click()
  await flush()
  expect(host.querySelector('.calendar-current-time')).toBeNull()
  ;(host.querySelector('[aria-label="Periodo siguiente"]') as HTMLButtonElement).click()
  await flush()
  expect(host.querySelectorAll('.calendar-current-time')).toHaveLength(1)
  ;([...host.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Semana') as HTMLButtonElement).click()
  await flush()
  expect(host.querySelectorAll('.calendar-current-time')).toHaveLength(1)
  expect(host.querySelectorAll('.calendar-day-column')).toHaveLength(7)
})

it('alinea filas con registros en Semana y compensa la cabecera de recursos en Día', async () => {
  const today = calendar.localDateKey(new Date())
  const event = { id: 'cita-1', customData: {}, updatedAt: '', date: today, time: '20:00', durationMinutes: 60, title: 'Cita', color: null, groupValue: 'sala-1', groupLabel: 'Sala 1' }
  const { host } = mountStandaloneCalendar(vi.fn(), [event])
  await flush()
  expect(host.querySelectorAll('.calendar-hours span')).toHaveLength(24)
  expect(host.querySelectorAll('.calendar-time-slot')).toHaveLength(24)
  expect(host.querySelector('.calendar-resource-spacer')).not.toBeNull()
  expect((host.querySelector('.calendar-event') as HTMLElement).style.top).toBe(`${20 * 64 + 38}px`)
  ;([...host.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Semana') as HTMLButtonElement).click()
  await flush()
  expect(host.querySelectorAll('.calendar-hours span')).toHaveLength(24)
  expect(host.querySelectorAll('.calendar-time-slot')).toHaveLength(7 * 24)
  expect(host.querySelector('.calendar-event')).not.toBeNull()
})

it('calendario conserva vista y fecha durante cargas y consulta solo al cambiar el rango', async () => {
  const { host, requests, calendarPending } = mountCalendarPage()
  await flush()
  expect(requests).toHaveLength(1)
  const shell = host.querySelector('.calendar-shell')
  expect(shell).not.toBeNull()

  const heading = host.querySelector('.calendar-heading')?.textContent
  ;(host.querySelector('[aria-label="Periodo siguiente"]') as HTMLButtonElement).click()
  await flush()
  expect(requests).toHaveLength(2)
  expect(host.querySelector('.calendar-shell')).toBe(shell)
  expect(host.querySelector('.calendar-heading')?.textContent).not.toBe(heading)
  calendarPending.value = false
  await flush()

  ;([...host.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Semana') as HTMLButtonElement).click()
  await flush()
  expect(requests).toHaveLength(3)
  expect(host.querySelector('.calendar-shell')).toBe(shell)
  expect(host.querySelector('.calendar-views button.active')?.textContent).toBe('Semana')
  const weekRange = requests.at(-1)!
  expect(weekRange.from).not.toBe(requests[1]!.from)
  calendarPending.value = false
  await flush()

  ;([...host.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Mes') as HTMLButtonElement).click()
  await flush()
  expect(requests).toHaveLength(4)
  expect(host.querySelector('.calendar-shell')).toBe(shell)
  expect(host.querySelector('.calendar-views button.active')?.textContent).toBe('Mes')
  calendarPending.value = false
  await flush()
  expect(host.querySelector('.calendar-month')).not.toBeNull()
  ;([...host.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Mes') as HTMLButtonElement).click()
  await flush()
  expect(requests).toHaveLength(4)
})

it('QuickCreate usa un fallback estable durante SSR e hidratación', async () => {
  const layout = await import('node:fs').then(({ readFileSync }) => readFileSync('layouts/default.vue', 'utf8'))
  expect(layout).toContain('<ClientOnly v-if="!editorFullscreen">')
  expect(layout).toContain('<template #fallback><span class="block h-11 w-11" aria-hidden="true" /></template>')

  let clientData = false
  const quickCreate = compileVueComponent('components/QuickCreate.vue', {
    '~/utils/moduleIcons': { moduleIconComponent: () => ({ render: () => vue.h('svg') }) }
  }, { ...vue, useUnifiedNavigation: () => ({ quickCreate: vue.ref(clientData ? [{ id: 'cita', slug: 'agenda-citas', name: 'Citas' }] : []) }) })
  const clientOnly = vue.defineComponent({
    setup(_, { slots }) {
      const mounted = vue.ref(false)
      vue.onMounted(() => { mounted.value = true })
      return () => mounted.value ? slots.default?.() : slots.fallback?.()
    }
  })
  const root = vue.defineComponent({ setup: () => () => vue.h(clientOnly, null, {
    default: () => vue.h(quickCreate),
    fallback: () => vue.h('span', { class: 'block h-11 w-11', 'aria-hidden': 'true' })
  }) })
  const serverHtml = await renderToString(vue.createSSRApp(root))
  expect(serverHtml).toContain('aria-hidden="true"')
  clientData = true
  const host = document.createElement('div')
  host.innerHTML = serverHtml
  document.body.append(host)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = vue.createSSRApp(root)
  app.component('NuxtLink', vue.defineComponent({ props: ['to'], setup: (props, { slots }) => () => vue.h('a', { href: props.to }, slots.default?.()) }))
  apps.push(app)
  app.mount(host)
  await flush()
  expect(warn.mock.calls.flat().join(' ')).not.toMatch(/hydration.*mismatch|mismatch.*hydration/i)
  expect(host.querySelector('button[aria-label="Crear registro"]')).not.toBeNull()
})
