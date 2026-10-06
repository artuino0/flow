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
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })

function mountCalendarPage() {
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
  const globals = {
    ...vue,
    definePageMeta: vi.fn(),
    useRoute: () => ({ params: { entity: 'agenda-citas' }, query: {} }),
    useAuth: () => ({ user: vue.ref({ roleId: 'role-citas' }) }),
    useEntityFields: async () => ({ data: meta, pending: vue.ref(false), error: vue.ref(null) }),
    useIsAdmin: async () => ({ data: vue.ref(false) }),
    useRequestHeaders: () => ({}),
    useToast: () => ({ error: vi.fn(), success: vi.fn() }),
    navigateTo: vi.fn(),
    useFetch: async (url: string, options: { query?: vue.ComputedRef<Record<string, unknown>> } = {}) => {
      if (url.endsWith('/calendar')) {
        const query = options.query!
        requests.push({ from: String(query.value.from), to: String(query.value.to) })
        vue.watch(query, value => {
          requests.push({ from: String(value.from), to: String(value.to) })
          calendarPending.value = true
        })
        return { data: calendarData, pending: calendarPending, error: vue.ref(null), refresh: vi.fn() }
      }
      const data = url.endsWith('/board')
        ? vue.ref(null)
        : vue.ref({ data: [], page: 1, pageSize: 20, total: 0, relationLabels: {} })
      return { data, pending: vue.ref(false), error: vue.ref(null), refresh: vi.fn() }
    }
  }
  const childGlobals = { ...vue, useToast: globals.useToast }
  const recordCalendar = compileVueComponent('components/RecordCalendar.vue', { '~/utils/calendar': calendar }, childGlobals)
  const page = compileVueComponent('pages/registros/[entity]/index.vue', {
    '~/utils/calendar': calendar,
    '~/utils/listFilters': listFilters,
    '~/utils/relativeTime': relativeTime
  }, globals)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, null, { default: () => vue.h(page) }) })
  app.component('RecordCalendar', recordCalendar)
  app.component('NuxtLink', vue.defineComponent({ props: ['to'], setup: (props, { slots }) => () => vue.h('a', { href: props.to }, slots.default?.()) }))
  app.component('RecordKanbanBoard', { render: () => null })
  app.component('DynamicTable', { render: () => null })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  apps.push(app)
  return { host, requests, calendarPending, calendarData }
}

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
