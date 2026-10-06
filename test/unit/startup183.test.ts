// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { writeFileSync } from 'node:fs'
import { loadNuxtSource183 } from '../helpers/nuxt183'
import { compileVueComponent } from '../helpers/vueComponent'
import * as flowApps from '../../utils/flowApps'
import * as sidebar from '../../utils/sidebarPlanUsage'
import * as tours from '../../utils/onboardingTours'
import * as siteNav from '../../utils/siteNavigation'
import * as unifiedNavigation from '../../utils/unifiedNavigation'
import * as returnToRoute from '../../utils/returnToRoute'
import { createMemoryHistory, createRouter, isNavigationFailure } from 'vue-router'
import * as realtimeRetry from '../../utils/realtimeRetry'
import * as planLimit from '../../utils/planLimit'

const apps: vue.App[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })
function harness(client = true) {
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia
  const states = new Map<string, vue.Ref>()
  const counts: Record<string, number> = {}
  const calls: string[] = []
  const route = vue.reactive({ path: '/', fullPath: '/', query: {}, params: {}, meta: {} })
  const user = { id: 'user', tenantId: 'tenant', roleId: 'admin', sessionId: 'sid', authenticated: true, isAdmin: true, emailVerified: true, onboardingStatus: 'complete', fullName: 'Prueba' }
  const useState = (key: string, init = () => null) => { if (!states.has(key)) states.set(key, vue.ref(init())); return states.get(key)! }
  const realtime = { state: vue.ref({ connected: true }), resumeSession() {}, start() {}, stop() {}, subscribe: () => () => {} }
  const fetch = vi.fn(async (url: string): Promise<Record<string, unknown>> => {
    counts[url] = (counts[url] ?? 0) + 1; calls.push(url)
    await Promise.resolve()
    if (url === '/api/auth/login') return { ok: true, requiresTotp: false, requiresOrgSelection: false, user }
    if (url === '/api/auth/me') return { ...user }
    if (url === '/api/account/status') return { account: { phase: 'active' } }
    if (url === '/api/auth/refresh') return { user }
    if (url === '/api/config') return { realtimeTransport: 'websocket' }
    if (url === '/api/license/status') return { required: false, activated: false }
    if (url === '/api/apps') return { apps: flowApps.FLOW_APP_LIST.map(app => ({ key: app.key, enabled: true, accessible: true })) }
    if (url === '/api/nav/entities') return { groups: [], unassigned: [] }
    if (url === '/api/navigation/pins') return { keys: [] }
    if (url.startsWith('/api/entities')) return { entities: [] }
    if (url === '/api/dashboard/operational') return { modules: [], activity: [], activityTotal: 0 }
    if (url === '/api/dashboard/shortcuts') return { available: [], shortcuts: [] }
    if (url === '/api/billing/plan-usage') return { plan: 'Pro', code: 'pro', usage: [] }
    if (url === '/api/billing/overview') return { subscription: null }
    if (url === '/api/chat/permissions') return { effective: { canAccess: true } }
    if (url === '/api/sites') return { sites: [] }
    return { items: [], unreadCount: 0 }
  })
  const entries = new Map<string, { data: vue.Ref; pending: vue.Ref; error: vue.Ref; status: vue.Ref; flight?: Promise<unknown> }>()
  const useAsyncData = (key: string, handler: () => Promise<unknown>, options: Record<string, unknown> = {}) => {
    if (!entries.has(key)) entries.set(key, { data: vue.ref(null), pending: vue.ref(false), error: vue.ref(null), status: vue.ref('idle') })
    const entry = entries.get(key)!
    const execute = async () => {
      if (options.dedupe === 'defer' && entry.flight) return entry.flight
      entry.pending.value = true
      entry.flight = handler().then(value => { entry.data.value = value; nuxtApp.payload.data[key] = value; entry.status.value = 'success' }).finally(() => { entry.pending.value = false; entry.flight = undefined })
      return entry.flight
    }
    if (options.watch) vue.watch(options.watch as vue.WatchSource[], execute)
    // Nuxt instalado consulta payload/static o getCachedData; un ref resuelto por sí solo no evita el initial fetch.
    const cached = typeof options.getCachedData === 'function' ? options.getCachedData(key, nuxtApp, { cause: 'initial' }) : undefined
    const initial = options.immediate === false || cached != null ? Promise.resolve() : execute()
    if (cached != null) entry.data.value = cached
    const result = { ...entry, refresh: execute, execute }
    return Object.assign(result, { then: (resolve: (value: unknown) => unknown) => initial.then(() => resolve({ ...entry, refresh: execute, execute })) })
  }
  const globals: Record<string, unknown> = { ...vue, useState, $fetch: fetch, useAsyncData, useRoute: () => route,
    useRequestFetch: () => fetch,
    useRequestHeaders: () => ({ cookie: 'synthetic' }), useRealtime: () => realtime, clearNuxtData() {},
    definePageMeta() {}, defineNuxtRouteMiddleware: (fn: unknown) => fn, navigateTo: vi.fn(async (target: unknown) => target),
    preloadRouteComponents: vi.fn(async () => {}), onNuxtReady: (fn: () => void) => setTimeout(fn, 0), useNuxtApp: () => nuxtApp,
    useOnboarding: () => ({ navigationTourId: vue.ref(null), navigationTourIndex: vue.ref(0) }), useSettingsDirty: () => ({ dirty: vue.ref(false) }),
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
    useConfirm: () => ({ dialog: vue.ref(null), settle() {} }), useIdleTimeout: () => ({ showWarning: vue.ref(false) }) }
  const hooks = new Map<string, Function>()
  const nuxtApp = { payload: { data: {} as Record<string, unknown> }, static: { data: {} as Record<string, unknown> }, hook: vi.fn((name: string, fn: Function) => { hooks.set(name, fn); return () => hooks.delete(name) }), isHydrating: false }
  globals.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 16)
  globals.useNuxtData = () => ({ data: vue.ref({ realtimeTransport: 'websocket' }) })
  globals.WebSocket = class {
    static OPEN = 1; static CONNECTING = 0
    readyState = 0
    addEventListener() {}
    close() {}
  }
  globals.useFetch = (url: string, options: Record<string, unknown> = {}) => useAsyncData(String(options.key ?? url), () => {
    const query = vue.unref(options.query as Record<string, string> | vue.Ref<Record<string, string>>)
    return fetch(query ? `${url}?${new URLSearchParams(query)}` : url)
  }, options)
  const load = (file: string, imports: Record<string, unknown> = {}) => Object.assign(globals, loadNuxtSource183(file, globals, imports, client))
  load('composables/useAuth.ts'); load('composables/useIsAdmin.ts'); load('composables/useFlowAppAccess.ts')
  if (readFileSyncSafe('composables/useAfterFirstPaint.ts')) load('composables/useAfterFirstPaint.ts')
  if (readFileSyncSafe('composables/useShellResource.ts')) load('composables/useShellResource.ts')
  load('composables/useRealtime.ts', { '~/utils/realtimeRetry': realtimeRetry })
  load('composables/useDesignerPlanUsage.ts'); load('composables/useBillingOverview.ts'); load('composables/useChat.ts')
  load('composables/useUnifiedNavigation.ts', { '~/utils/unifiedNavigation': unifiedNavigation })
  load('composables/useNotifications.ts'); load('composables/useIdleTimeout.ts')
  load('composables/usePlanLimit.ts', { '~/utils/planLimit': planLimit })
  Object.assign(nuxtApp, { runWithContext: (fn: () => unknown) => fn() })
  return { globals, counts, calls, route, states, user, fetch, load, useState, hooks, nuxtApp }
}
import { existsSync } from 'node:fs'
const readFileSyncSafe = existsSync
const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); await vue.nextTick() } }
const stub = vue.defineComponent({ setup: (_, { slots }) => () => vue.h('div', slots.default?.({ href: '#', navigate() {} })) })
function mount(component: vue.Component, children: Record<string, vue.Component> = {}) {
  const host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, null, { default: () => vue.h(component) }) })
  app.config.warnHandler = () => {}; for (const [key, child] of Object.entries(children)) app.component(key, child)
  app.component('NuxtLink', stub); app.component('ClientOnly', stub); app.component('AppNavTooltip', stub)
  app.mount(host); apps.push(app); return host
}
it('conteo del login, cascarón real y navegación: sin roles por red ni duplicados', async () => {
  vi.useFakeTimers()
  const h = harness()
  // Reproduce los 18 consumidores de la captura; no atribuye esa multiplicidad a todas las rutas.
  mount(vue.defineComponent({ setup() {
    const admin = (h.globals.useIsAdmin as Function)()
    for (let i = 0; i < 17; i++) (h.globals.useIsAdmin as Function)()
    // app.vue/useOnboarding ya consumen el plan antes de montar el layout autenticado.
    ;(h.globals.useDesignerPlanUsage as Function)(admin.data)
    return () => vue.h('div')
  } }))
  await flush(); for (const key of Object.keys(h.counts)) delete h.counts[key]; h.calls.length = 0
  await (h.globals.useAuth as Function)().login('synthetic@test.local', 'synthetic')
  await flush()
  const middleware = loadNuxtSource183('middleware/auth.global.ts', h.globals, { '~/utils/flowApps': flowApps }).default
  await middleware(h.route)
  const imports = { '~/utils/sidebarPlanUsage': sidebar, '~/utils/onboardingTours': tours, '~/utils/siteNavigation': siteNav,
    '~/utils/unifiedNavigation': unifiedNavigation,
    '~/utils/flowApps': flowApps, '~/components/AppNavGroup.vue': stub, '~/components/AppNavEntity.vue': stub,
    '~/utils/moduleIcons': { moduleIconComponent: () => stub }, '~/utils/theme': { contentNeedsLight: () => false },
    '~/utils/returnToRoute': { IDLE_RETURN_KEY: 'idle', safeInternalRoute: () => null } }
  const component = (file: string) => compileVueComponent(file, imports, h.globals)
  mount(component('layouts/default.vue'), { AppNav: component('components/AppNav.vue'), QuickCreate: component('components/QuickCreate.vue'), NavigationMore: component('components/NavigationMore.vue'), NavigationPinnedItem: component('components/NavigationPinnedItem.vue'),
    SidebarPlanUsage: component('components/SidebarPlanUsage.vue'), NotificationCenter: component('components/NotificationCenter.vue'), ChatFloatingDock: component('components/ChatFloatingDock.vue') })
  const host = mount(component('pages/index.vue'))
  await flush()
  h.useState('auth-navigation-pending').value = false
  const beforePaint = { ...h.counts }
  await vi.advanceTimersByTimeAsync(300); await flush()
  const afterIdle = { ...h.counts }
  h.route.path = '/modulos'; h.route.fullPath = '/modulos'; await middleware(h.route); await flush()
  mount(component('pages/modulos/index.vue'), { ModuleListing: component('components/ModuleListing.vue'), ListPageHeader: stub })
  await flush()
  const navigation = Object.fromEntries(Object.entries(h.counts).map(([url, count]) => [url, count - (afterIdle[url] ?? 0)]).filter(([, count]) => count))
  console.log(JSON.stringify({ beforePaint, afterIdle, navigation, calls: h.calls }))
  if (process.env.ERD183_STAGE) writeFileSync(`C:/desarrollo/ERP-Dinamico/DOCS/tareas/erd183-count-${process.env.ERD183_STAGE}.json`, JSON.stringify({ beforePaint, afterIdle, navigation, calls: h.calls }, null, 2))
  expect(host.textContent).toContain('Prueba')
  expect(h.counts['/api/roles'] ?? 0).toBe(0)
  expect(h.counts['/api/auth/me'] ?? 0).toBe(0)
  expect(h.counts['/api/chat/conversations']).toBe(1)
  expect(h.counts['/api/chat/conversations?archived=true']).toBe(1)
  expect(Object.values(beforePaint).reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(10)
  for (const [url, count] of Object.entries(afterIdle)) expect(count, url).toBe(1)
  expect(navigation).toEqual({ '/api/account/status': 1, '/api/entities?moduleKind=hecho&deleted=exclude': 1 })
})

it.each([true, false])('SSR deriva administrador=%s antes del render y cambia sin red', async admin => {
  const h = harness(false)
  h.useState('auth-user').value = { ...h.user, isAdmin: admin }
  const permission = (h.globals.useIsAdmin as Function)()
  expect(permission.data.value).toBe(admin); expect(permission.pending.value).toBe(false); expect(permission.status.value).toBe('success')
  const host = mount(vue.defineComponent({ setup: () => () => vue.h('nav', permission.data.value ? 'Administración' : 'Cuenta') }))
  expect(host.textContent).toBe(admin ? 'Administración' : 'Cuenta')
  h.useState('auth-user').value = { ...h.user, roleId: 'changed', isAdmin: !admin }; await flush()
  expect(permission.data.value).toBe(!admin); expect(h.fetch).not.toHaveBeenCalled()
})

it('me y refresh comparten peticiones en vuelo; refresh actualiza rol y conserva la recuperación', async () => {
  const h = harness(), a = (h.globals.useAuth as Function)(), b = (h.globals.useAuth as Function)()
  const original = h.fetch.getMockImplementation()!
  h.fetch.mockImplementation(async url => url === '/api/auth/refresh' ? { user: { ...h.user, isAdmin: false, roleId: 'member' } } : original(url))
  await Promise.all([a.fetchMe(), b.fetchMe()]); expect(h.counts['/api/auth/me']).toBe(1)
  await Promise.all([a.refresh(), b.refresh()]); expect(h.fetch.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1)
  expect(a.user.value.isAdmin).toBe(false)
  const recovery = harness(); recovery.fetch.mockImplementation(async url => {
    recovery.counts[url] = (recovery.counts[url] ?? 0) + 1
    if (url === '/api/auth/me') throw new Error('expired')
    if (url === '/api/auth/refresh') return { user: recovery.user }
    return {}
  })
  const auth = (recovery.globals.useAuth as Function)()
  expect(await auth.fetchMe()).toMatchObject({ id: 'user' })
  expect(recovery.counts).toEqual({ '/api/auth/me': 1, '/api/auth/refresh': 1 })
})

it.each([
  { name: 'sin licencia requerida', license: { required: false, activated: false }, target: '/modulos', expected: null },
  { name: 'licencia no activada', license: { required: true, activated: false }, target: '/modulos', expected: { path: '/activar', query: { redirect: '/modulos' } } },
  { name: 'activación sin licencia requerida', license: { required: false, activated: false }, target: '/activar', expected: '/login' },
  { name: 'activación pendiente', license: { required: true, activated: false }, target: '/activar', expected: null },
  { name: 'correo sin verificar', verified: false, target: '/modulos', expected: '/confirmar-correo' },
  { name: 'onboarding pendiente', onboarding: 'plan_pending', target: '/modulos', expected: '/elegir-plan' },
  { name: 'app deshabilitada', disabled: true, target: '/sites', expected: '/' },
  { name: 'app activa sin permiso', denied: true, target: '/sites/pages', expected: '/' },
  { name: 'sin sesión', anonymous: true, target: '/modulos', expected: { path: '/login', query: { redirect: '/modulos' } } },
  { name: 'login autenticado', target: '/login', expected: '/' },
  { name: 'confirmación de correo ya completada', target: '/confirmar-correo', expected: '/' },
  { name: 'plan ya completado', target: '/elegir-plan', expected: '/' },
  { name: 'registro completo', target: '/registro-completo', expected: null }
])('middleware conserva redirección: $name', async scenario => {
  const h = harness()
  h.useState('auth-user').value = scenario.anonymous ? null : { ...h.user, emailVerified: scenario.verified ?? true, onboardingStatus: scenario.onboarding ?? 'complete' }
  const original = h.fetch.getMockImplementation()!
  h.fetch.mockImplementation(async url => {
    if (scenario.anonymous && (url === '/api/auth/me' || url === '/api/auth/refresh')) throw new Error('anonymous')
    if (url === '/api/license/status') return scenario.license ?? { required: false, activated: false }
    if (scenario.disabled && url === '/api/apps') return { apps: flowApps.FLOW_APP_LIST.map(app => ({ key: app.key, enabled: false, accessible: false })) }
    if (scenario.denied && url === '/api/apps') return { apps: flowApps.FLOW_APP_LIST.map(app => ({ key: app.key, enabled: true, accessible: app.key !== 'sites' })) }
    return original(url)
  })
  const middleware = loadNuxtSource183('middleware/auth.global.ts', h.globals, { '~/utils/flowApps': flowApps }).default
  await middleware({ path: scenario.target, fullPath: scenario.target, query: {} })
  const navigate = h.globals.navigateTo as ReturnType<typeof vi.fn>
  if (scenario.expected === null) expect(navigate).not.toHaveBeenCalled()
  else expect(navigate).toHaveBeenCalledWith(scenario.expected)
})

it('middleware inicia licencia y apps antes de resolverlas y no vuelve a pedir me tras login', async () => {
  const h = harness(); h.useState('auth-user').value = h.user
  const waiting = new Map<string, (value: Record<string, unknown>) => void>()
  h.fetch.mockImplementation(url => new Promise(resolve => waiting.set(url, resolve)))
  const middleware = loadNuxtSource183('middleware/auth.global.ts', h.globals, { '~/utils/flowApps': flowApps }).default
  const navigating = middleware({ path: '/', fullPath: '/' })
  expect([...waiting.keys()].sort()).toEqual(['/api/account/status', '/api/apps', '/api/license/status'])
  waiting.get('/api/account/status')!({ account: { phase: 'active' } })
  waiting.get('/api/apps')!({ apps: [{ key: 'core', enabled: true, accessible: true }] })
  waiting.get('/api/license/status')!({ required: false, activated: false })
  await navigating
  expect(h.globals.navigateTo).not.toHaveBeenCalled()
})

async function mountLogin183() {
  const h = harness()
  h.globals.useDeploymentConfig = async () => ({ data: vue.ref({ appMode: 'saas' }) })
  const host = mount(compileVueComponent('pages/login.vue', { '~/utils/returnToRoute': returnToRoute, 'vue-router': { isNavigationFailure } }, h.globals))
  await flush()
  const form = () => host.querySelector('form')!
  const submit = () => { form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return flush() }
  return { h, host, submit }
}
it('botón permanece ocupado tras router.push hasta page:finish y rechaza doble envío', async () => {
  const { h, host, submit } = await mountLogin183()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', component: stub }, { path: '/', component: stub }] })
  await router.push('/login')
  ;(h.globals.navigateTo as ReturnType<typeof vi.fn>).mockImplementation((target: string) => router.push(target))
  await submit()
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!
  expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true'); expect(button.textContent).toContain('Entrando')
  await submit(); expect(h.counts['/api/auth/login']).toBe(1)
  expect(router.currentRoute.value.path).toBe('/')
  expect(button.disabled).toBe(true)
  h.hooks.get('page:finish')!(); await flush(); expect(button.disabled).toBe(false)
})
it('navegación abortada por el router libera el botón y comunica el fallo', async () => {
  const { h, host, submit } = await mountLogin183()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', component: stub }, { path: '/', component: stub }] })
  await router.push('/login'); router.beforeEach(() => false)
  ;(h.globals.navigateTo as ReturnType<typeof vi.fn>).mockImplementation((target: string) => router.push(target))
  await submit()
  expect(host.textContent).toContain('No se pudo iniciar sesion.')
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  expect(router.currentRoute.value.path).toBe('/login')
  expect(h.hooks.has('page:finish')).toBe(false)
})
it('error de login muestra mensaje y libera el botón sin navegar', async () => {
  const { h, host, submit } = await mountLogin183()
  h.fetch.mockRejectedValue({ data: { statusMessage: 'Credenciales inválidas' } })
  await submit()
  expect(host.textContent).toContain('Credenciales inválidas')
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  expect(h.globals.navigateTo).not.toHaveBeenCalled()
})
it('un error de render durante la navegación libera el botón y retira sus hooks', async () => {
  const { h, host, submit } = await mountLogin183(); await submit()
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  h.hooks.get('vue:error')!({ data: { statusMessage: 'No se pudo cargar la pantalla' } }); await flush()
  expect(host.textContent).toContain('No se pudo cargar la pantalla')
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  expect(h.hooks.size).toBe(0)
})

it('TOTP y selección de organización conservan los pasos y aceptan el usuario sin me', async () => {
  const { h, host, submit } = await mountLogin183()
  h.fetch.mockImplementation(async url => {
    h.counts[url] = (h.counts[url] ?? 0) + 1
    if (url === '/api/auth/login') return { requiresTotp: true, tempToken: 'temporary' }
    if (url === '/api/auth/login/totp') return { requiresOrgSelection: true, pendingToken: 'pending', organizations: [{ tenantId: 'tenant', tenantName: 'Fixture' }] }
    if (url === '/api/auth/login/select-org') return { user: h.user }
    throw new Error(`Petición inesperada: ${url}`)
  })
  await submit()
  expect(host.textContent).toContain('Verificar'); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  const code = host.querySelector<HTMLInputElement>('#totpCode')!; code.value = '123456'; code.dispatchEvent(new Event('input')); await flush()
  await submit(); expect(host.textContent).toContain('Elige tu organización')
  const trigger = [...host.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find(button => button.textContent?.includes('Selecciona una organización'))!
  trigger.click(); await flush()
  const option = [...host.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find(button => button.textContent?.includes('Fixture'))!
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await flush()
  await submit(); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  h.hooks.get('page:finish')!(); await flush()
  expect(h.counts).toEqual({ '/api/auth/login': 1, '/api/auth/login/totp': 1, '/api/auth/login/select-org': 1 })
  expect(h.useState('auth-user').value).toMatchObject({ isAdmin: true })
})

it.each(['totp', 'organization'])('el error del paso %s muestra mensaje y permite reintentar', async step => {
  const { h, host, submit } = await mountLogin183()
  h.fetch.mockImplementation(async url => {
    if (url === '/api/auth/login') return step === 'totp'
      ? { requiresTotp: true, tempToken: 'temporary' }
      : { requiresOrgSelection: true, pendingToken: 'pending', organizations: [{ tenantId: 'tenant', tenantName: 'Fixture' }] }
    throw { data: { statusMessage: 'No se pudo verificar el acceso' } }
  })
  await submit()
  if (step === 'totp') {
    const code = host.querySelector<HTMLInputElement>('#totpCode')!
    code.value = '123456'; code.dispatchEvent(new Event('input')); await flush()
  } else {
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find(button => button.textContent?.includes('Selecciona una organización'))!
    trigger.click(); await flush()
    const option = [...host.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find(button => button.textContent?.includes('Fixture'))!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await flush()
  }
  await submit()
  expect(host.textContent).toContain('No se pudo verificar el acceso')
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  expect(h.globals.navigateTo).not.toHaveBeenCalled()
})

it('los recursos secundarios esperan datos del Tablero y dos frames antes de competir', async () => {
  vi.useFakeTimers()
  const h = harness(); h.useState('auth-user').value = h.user
  const original = h.fetch.getMockImplementation()!
  let finish!: (value: Record<string, unknown>) => void
  h.fetch.mockImplementation(url => url === '/api/dashboard/operational' ? new Promise(resolve => { finish = resolve }) : original(url))
  const resource = (h.globals.useShellResource as Function)('test-idle', '/api/billing/overview')
  const host = mount(compileVueComponent('pages/index.vue', { '~/utils/moduleIcons': { moduleIconComponent: () => stub } }, h.globals))
  await flush(); await vi.advanceTimersByTimeAsync(300)
  expect(h.counts['/api/billing/overview'] ?? 0).toBe(0)
  finish({ modules: [], activity: [], activityTotal: 0 }); await flush()
  await vi.advanceTimersByTimeAsync(100); await resource.execute()
  expect(h.counts['/api/billing/overview']).toBe(1); expect(host.textContent).toContain('Prueba')
})
it('un consumidor global espera la navegación aunque el Tablero aún no esté montado', async () => {
  vi.useFakeTimers()
  const h = harness()
  const admin = (h.globals.useIsAdmin as Function)()
  const resource = (h.globals.useDesignerPlanUsage as Function)(admin.data)
  await (h.globals.useAuth as Function)().login('fixture@test.local', 'fixture')
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.counts['/api/billing/plan-usage'] ?? 0).toBe(0)
  h.useState('auth-navigation-pending').value = false; await flush()
  await vi.advanceTimersByTimeAsync(100); await resource.execute()
  expect(h.counts['/api/billing/plan-usage']).toBe(1)
  // Otra sesión en la misma app requiere una espera nueva, aunque la primera ya resolvió.
  h.useState('auth-navigation-pending').value = true
  h.useState('auth-user').value = { ...h.user, sessionId: 'second-login' }; await flush()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.counts['/api/billing/plan-usage']).toBe(1)
  h.useState('auth-navigation-pending').value = false; await flush()
  await vi.advanceTimersByTimeAsync(100); await resource.execute()
  expect(h.counts['/api/billing/plan-usage']).toBe(2)
})

it('una respuesta en vuelo de otra sesión no publica datos en la sesión nueva', async () => {
  const h = harness(); h.useState('auth-user').value = h.user
  const responses: Array<(value: Record<string, unknown>) => void> = []
  h.fetch.mockImplementation(() => new Promise(resolve => responses.push(resolve)))
  const resource = (h.globals.useShellResource as Function)('race', '/api/nav/entities', () => true, false)
  const first = resource.execute()
  h.useState('auth-user').value = { ...h.user, sessionId: 'second' }; await flush()
  const second = resource.execute()
  responses[1]!({ groups: ['second'] }); await second
  responses[0]!({ groups: ['first'] }); expect(await first).toBeNull()
  expect(resource.data.value).toEqual({ groups: ['second'] })
})
it('login y conexión diferida recuperan el contexto Nuxt antes de usar composables', async () => {
  vi.useFakeTimers()
  const h = harness()
  let context = false
  Object.assign(h.nuxtApp, { runWithContext: (fn: () => unknown) => {
    const previous = context; context = true
    try { return fn() } finally { context = previous }
  } })
  h.globals.useNuxtApp = () => { if (!context) throw new Error('Nuxt instance unavailable'); return h.nuxtApp }
  h.globals.useNuxtData = () => { expect(context).toBe(true); return { data: vue.ref({ realtimeTransport: 'websocket' }) } }
  h.globals.onNuxtReady = (fn: () => void) => { expect(context).toBe(true); setTimeout(fn, 0) }
  const run = (fn: () => unknown) => (h.nuxtApp as unknown as { runWithContext: (fn: () => unknown) => unknown }).runWithContext(fn)
  const auth = run(() => (h.globals.useAuth as Function)()) as { login: (email: string, password: string) => Promise<unknown> }
  await auth.login('fixture@test.local', 'fixture')
  h.useState('auth-navigation-pending').value = false
  const realtime = run(() => (h.globals.useRealtime as Function)()) as { start: () => void; stop: () => void }
  realtime.start()
  await vi.advanceTimersByTimeAsync(150); await flush()
  expect(h.counts['/api/auth/refresh'] ?? 0).toBe(0)
  expect(h.counts['/api/config'] ?? 0).toBe(0)
  realtime.stop()
})

it('remontar notificaciones conserva las insignias recibidas en tiempo real y las lecturas', async () => {
  vi.useFakeTimers()
  const h = harness(); h.useState('auth-user').value = h.user
  const callbacks = new Map<string, Function>()
  h.globals.useRealtime = () => ({ state: vue.ref({ connected: true }), start() {}, stop() {}, subscribe(name: string, fn: Function) { callbacks.set(name, fn); return () => callbacks.delete(name) } })
  h.load('composables/useNotifications.ts')
  const first = (h.globals.useNotifications as Function)(); first.start()
  await vi.advanceTimersByTimeAsync(150); await flush()
  callbacks.get('notification.created')!({ payload: { id: 'notice', title: 'Aviso', message: 'Nuevo', createdAt: new Date().toISOString(), readAt: null } })
  expect(first.state.value.unreadCount).toBe(1); first.stop()
  const second = (h.globals.useNotifications as Function)(); second.start(); await flush()
  expect(second.state.value.unreadCount).toBe(1); expect(second.state.value.items[0].id).toBe('notice')
  expect(h.counts['/api/notifications?limit=30']).toBe(1)
  await second.markRead('notice'); second.stop()
  const third = (h.globals.useNotifications as Function)(); third.start(); await flush()
  expect(third.state.value.unreadCount).toBe(0); expect(third.state.value.items[0].readAt).toBeTruthy(); third.stop()
})
