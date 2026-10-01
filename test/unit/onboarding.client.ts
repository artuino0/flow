import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, reactive, ref, watch, type Ref } from 'vue'
import { useOnboarding } from '../../composables/useOnboarding'
import { useChattitoHelp } from '../../composables/useChattitoHelp'
import { useModuleTourHelp, useContextualTourHelp } from '../../composables/useModuleTourHelp'
import { resolveChattitoContext } from '../../utils/chattitoContext'
import { MODULE_EDIT_TOURS, onboardingTours, TOUR_SELECTORS, waitForTourTarget, tourNeedsAdministration, tourNeedsMobileMenu } from '../../utils/onboardingTours'
import { runAgentAction, AGENT_TOUR_FAILURE, AGENT_MODULE_TOUR_HELP, type AgentActionDependencies } from '../../utils/agentActions'

const harness = vi.hoisted(() => ({ drive: vi.fn(), destroy: vi.fn(), createDriver: vi.fn() }))
vi.mock('../../components/ChattitoAvatar.vue', () => ({ default: {} }))
vi.mock('driver.js', () => ({ driver: (config: unknown) => {
  harness.createDriver(config)
  return { drive: harness.drive, destroy: harness.destroy }
} }))

describe('lanzamiento y reanudación en el cliente sin navegador', () => {
  let states: Map<string, Ref>
  let onboarding: ReturnType<typeof useOnboarding>
  let route: { path: string; fullPath: string; params: { id: string }; query: { tab: string; section?: string }; meta: { layout: string } }
  let planRefresh: ReturnType<typeof vi.fn>
  let navigate: ReturnType<typeof vi.fn<(destination: string) => Promise<void>>>
  let addMessage: ReturnType<typeof vi.fn<(message: unknown) => number>>
  let panel: Ref<{ open: boolean; conversationStarted: boolean; avatarState: string; messages: unknown[] }>
  let admin: Ref<boolean>

  beforeEach(() => {
    vi.clearAllMocks()
    states = new Map()
    route = reactive({ path: '/modulos/actual/editar', fullPath: '/modulos/actual/editar?tab=flow&source=panel#mapa', params: { id: 'actual' }, query: { tab: 'flow' }, meta: { layout: 'default' } })
    admin = ref(true)
    panel = ref({ open: false, conversationStarted: false, avatarState: 'idle', messages: [] })
    addMessage = vi.fn(message => panel.value.messages.push(message))
    planRefresh = vi.fn()
    navigate = vi.fn(async (destination: string) => {
      const url = new URL(destination, 'https://local.test')
      route.path = url.pathname
      route.fullPath = destination
      route.query.tab = url.searchParams.get('tab') ?? 'info'
      route.query.section = url.searchParams.get('section') ?? undefined
      route.params.id = url.pathname.split('/')[2] ?? ''
    })
    const storage = new Map<string, string>()
    const target = { isConnected: true, getClientRects: () => [{}] }
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
    vi.stubGlobal('document', { body: {}, querySelector: () => target })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }))
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)
    })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('useAuth', () => ({ user: ref({ authenticated: true, id: 'u', tenantId: 't', sessionId: 's', emailVerified: true, onboardingStatus: 'complete' }) }))
    vi.stubGlobal('useIsAdmin', () => ({ data: admin, status: ref('success') }))
    vi.stubGlobal('useDesignerPlanUsage', () => ({ data: ref(null), status: ref('idle'), refresh: planRefresh }))
    vi.stubGlobal('useChattitoPanel', () => ({ panel, addMessage }))
    vi.stubGlobal('useToast', () => ({ error: vi.fn() }))
    onboarding = useOnboarding()
  })
  afterEach(() => { onboarding.stopTour(); vi.unstubAllGlobals() })

  function goToPlan() {
    route.path = '/ajustes'
    route.query.section = 'plan'
    route.fullPath = '/ajustes?section=plan&source=menu#consumo'
  }

  it('reproduce el rechazo silencioso anterior cuando push termina antes de actualizar useRoute', async () => {
    const routerPush = vi.fn(async () => undefined)
    await routerPush()
    expect(onboarding.canLaunchTour('ajustes-plan')).toBe(true)
    expect(await onboarding.startTour('ajustes-plan')).toBe(false)
    expect(addMessage).not.toHaveBeenCalled()
    goToPlan()
    await nextTick()
    expect(await onboarding.startTour('ajustes-plan')).toBe(true)
  })

  it('conserva el recorrido ante el observador tardío y lo pausa si el usuario sale después', async () => {
    goToPlan()
    expect(await onboarding.startTour('ajustes-plan')).toBe(true)
    onboarding.handleRouteChange()
    expect(onboarding.activeId.value).toBe('ajustes-plan')
    route.fullPath = '/ajustes?section=perfil'
    route.query.section = 'perfil'
    onboarding.handleRouteChange()
    expect(onboarding.activeId.value).toBeNull()
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'resume-tour', tourId: 'ajustes-plan' } }))
  })

  function actionDependencies(): AgentActionDependencies {
    return {
      route: () => route,
      routerPath: () => route.fullPath,
      push: async path => { await navigate(path); return true },
      nextTick: async () => { await nextTick() },
      isCurrent: () => true,
      prepareTour: onboarding.prepareTour,
      firstSelector: onboarding.firstTourSelector,
      waitTarget: (selector, ready, abort, timeoutMs) => waitForTourTarget(() => ready() ? selector ? document.querySelector(selector) : document.body : null, () => true, { timeoutMs, intervalMs: 10, abort }),
      startTour: onboarding.startTour,
      point: vi.fn(),
      message: text => addMessage({ role: 'assistant', text, emotion: 'idle' }),
      beforeTour: () => { panel.value.open = false }
    }
  }

  it('navega, espera useRoute diferido y el anclaje, procesa el watch y después inicia Plan', async () => {
    const deps = actionDependencies()
    let routerPath = route.fullPath
    let targetReady = false
    const target = { isConnected: true, getClientRects: () => [{}] }
    vi.stubGlobal('document', { body: {}, querySelector: () => targetReady ? target : null })
    deps.routerPath = () => routerPath
    deps.push = async path => {
      routerPath = path
      setTimeout(() => { void navigate(path); targetReady = true }, 20)
      return true
    }
    const events: string[] = []
    const stopWatching = watch(() => route.fullPath, () => { events.push('watch'); onboarding.handleRouteChange(); void nextTick().then(onboarding.startWelcomeOnce) })
    onboarding.agentActionPending.value = true
    deps.startTour = async id => { events.push('start'); return onboarding.startTour(id) }
    try {
      panel.value.open = true
      expect(await runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, deps)).toBe(true)
      expect(events).toEqual(['watch', 'start'])
      expect(harness.drive).toHaveBeenCalledOnce()
      expect(onboarding.activeId.value).toBe('ajustes-plan')
      expect(panel.value.open).toBe(false)
      onboarding.handleRouteChange()
      expect(onboarding.activeId.value).toBe('ajustes-plan')
      await navigate('/')
      await nextTick()
      expect(onboarding.activeId.value).toBeNull()
    } finally { stopWatching(); onboarding.agentActionPending.value = false }
  })

  it('un flush Vue normal tras push ocurre antes del inicio y no reproduce la carrera tardía', async () => {
    const events: string[] = []
    const stopWatching = watch(() => route.fullPath, () => { events.push('watch'); onboarding.handleRouteChange() })
    try {
      await navigate('/ajustes?section=plan')
      events.push('start')
      expect(await onboarding.startTour('ajustes-plan')).toBe(true)
      await nextTick()
      expect(events).toEqual(['watch', 'start'])
      expect(onboarding.activeId.value).toBe('ajustes-plan')
    } finally { stopWatching() }
  })

  it('muestra el rechazo por permiso y no deja un recorrido activo', async () => {
    admin.value = false
    expect(await runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, actionDependencies())).toBe(false)
    expect(addMessage).toHaveBeenCalledWith({ role: 'assistant', text: AGENT_TOUR_FAILURE, emotion: 'idle' })
    expect(onboarding.activeId.value).toBeNull()
  })

  it('espera permisos reales pendientes sin descartar el botón por canLaunchTour=false', async () => {
    const status = ref('pending')
    admin.value = false
    const request = new Promise<void>(resolve => setTimeout(() => { admin.value = true; status.value = 'success'; resolve() }, 20))
    vi.stubGlobal('useIsAdmin', () => Object.assign(request, { data: admin, status }))
    onboarding = useOnboarding()
    expect(onboarding.canLaunchTour('ajustes-plan')).toBe(false)
    expect(await runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, actionDependencies())).toBe(true)
    expect(onboarding.activeId.value).toBe('ajustes-plan')
    expect(addMessage).not.toHaveBeenCalled()
  })

  it('el primer elemento ausente produce un mensaje sin activar ni guardar un recorrido huérfano', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { body: {}, querySelector: () => null })
    try {
      const result = runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, actionDependencies())
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await result).toBe(false)
      expect(onboarding.activeId.value).toBeNull()
      expect(onboarding.pendingTour.value).toBeNull()
      expect(harness.drive).not.toHaveBeenCalled()
      expect(addMessage).toHaveBeenCalledWith({ role: 'assistant', text: AGENT_TOUR_FAILURE, emotion: 'idle' })
    } finally { vi.useRealTimers() }
  })

  it('prepara el menú manual cerrado antes del inicio sin activar el recorrido', async () => {
    const deps = actionDependencies()
    deps.prepareTour = async id => {
      const permitted = await onboarding.prepareTour(id)
      if (permitted) onboarding.agentPreparingTour.value = id
      return permitted
    }
    const target = { isConnected: true, getClientRects: () => [{}], addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('document', { body: {}, querySelector: () => tourNeedsAdministration(onboarding.navigationTourId.value, 'administration') ? target : null })
    deps.startTour = async id => {
      expect(onboarding.activeId.value).toBeNull()
      expect(onboarding.navigationTourIndex.value).toBe(0)
      expect(tourNeedsMobileMenu(route.path, onboarding.navigationTourId.value, onboarding.navigationTourIndex.value, true)).toBe(true)
      return onboarding.startTour(id)
    }
    try {
      expect(await runAgentAction({ kind: 'start-tour', tourId: 'crear-modulo-manual' }, deps)).toBe(true)
      expect(onboarding.activeId.value).toBe('crear-modulo-manual')
    } finally { onboarding.agentPreparingTour.value = null }
  })

  it.each(Object.entries(MODULE_EDIT_TOURS))('el agente inicia %s solo desde su edición concreta', async (tab, tourId) => {
    route.query.tab = tab
    route.fullPath = `/modulos/actual/editar?tab=${tab}`
    expect(await runAgentAction({ kind: 'start-tour', tourId }, actionDependencies())).toBe(true)
    expect(onboarding.activeId.value).toBe(tourId)
    expect(navigate).not.toHaveBeenCalled()
    onboarding.stopTour()
    route.path = '/modulos'
    route.fullPath = '/modulos'
    expect(await runAgentAction({ kind: 'start-tour', tourId }, actionDependencies())).toBe(false)
    expect(addMessage).toHaveBeenLastCalledWith({ role: 'assistant', text: AGENT_MODULE_TOUR_HELP, emotion: 'idle' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each(['bienvenida', 'primer-modulo', 'crear-modulo-manual'] as const)('el agente inicia el recorrido no contextual %s', async tourId => {
    vi.stubGlobal('useDesignerPlanUsage', () => ({ data: ref({ code: 'starter' }), status: ref('success'), refresh: planRefresh }))
    const target = { isConnected: true, getClientRects: () => [{}], addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('document', { body: {}, querySelector: () => target })
    vi.stubGlobal('watch', watch)
    onboarding = useOnboarding()
    expect(await runAgentAction({ kind: 'start-tour', tourId }, actionDependencies())).toBe(true)
    expect(onboarding.activeId.value).toBe(tourId)
    expect(harness.drive).toHaveBeenCalledOnce()
    if (tourId === 'crear-modulo-manual') expect(navigate).toHaveBeenCalledExactlyOnceWith('/ajustes')
  })

  it('la pregunta de Plan inicia sin navegación ni consulta del Diseñador y persiste el descarte', async () => {
    goToPlan()
    vi.stubGlobal('useOnboarding', () => onboarding)
    const help = useContextualTourHelp('settings:plan')
    expect(help.available.value).toBe(true)
    expect(await help.launch()).toBe(true)
    expect(onboarding.activeId.value).toBe('ajustes-plan')
    expect(harness.createDriver).toHaveBeenCalledWith(expect.objectContaining({ disableActiveInteraction: true }))
    expect(navigate).not.toHaveBeenCalled()
    expect(planRefresh).not.toHaveBeenCalled()
    expect(localStorage.getItem('flow-chattito-help:t:u:settings:plan:dismissed')).toBe('1')
    expect(help.disabled.value).toBe(true)
    expect(await help.launch()).toBe(false)
  })

  it.each(['perfil', 'salir'])('pausa Plan al cambiar a %s y reanuda la URL original', async section => {
    goToPlan()
    const original = route.fullPath
    expect(await onboarding.startTour('ajustes-plan')).toBe(true)
    route.query.section = section
    route.path = section === 'salir' ? '/' : '/ajustes'
    route.fullPath = section === 'salir' ? '/' : '/ajustes?section=perfil'
    const watcher = useOnboarding()
    watcher.handleRouteChange()
    expect(onboarding.activeId.value).toBeNull()
    expect(onboarding.pendingTour.value?.id).toBe('ajustes-plan')
    expect(await watcher.resumeTour('ajustes-plan')).toBe(true)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(original)
    expect(planRefresh).not.toHaveBeenCalled()
    watcher.stopTour()
  })

  it('Plan rechaza secciones ajenas y falta de permisos', async () => {
    expect(await onboarding.startTour('ajustes-plan')).toBe(false)
    goToPlan()
    admin.value = false
    expect(await onboarding.startTour('ajustes-plan')).toBe(false)
    admin.value = true
    route.query.section = 'perfil'
    expect(await onboarding.startTour('ajustes-plan')).toBe(false)
    expect(harness.drive).not.toHaveBeenCalled()
  })

  it.each(['aviso', 'explicación'])('lanza Plan desde %s sin navegación y conserva el descarte', async source => {
    const { effectScope, watch } = await import('vue')
    goToPlan()
    const scope = effectScope()
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useChattitoContext', () => ({ context: computed(() => resolveChattitoContext(route, true)) }))
    vi.stubGlobal('useChattitoHelpPreferences', () => ({ ready: ref(true), disabled: ref(false), setDisabled: vi.fn() }))
    vi.stubGlobal('useOnboarding', () => onboarding)
    try {
      const help = scope.run(useChattitoHelp)!
      expect(help.visible.value).toBe(true)
      expect(help.tourId.value).toBe('ajustes-plan')
      if (source === 'explicación') {
        help.explain()
        expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'start-tour', tourId: 'ajustes-plan', originPath: route.fullPath } }))
        expect(await onboarding.startTour('ajustes-plan')).toBe(true)
      } else {
        help.runTour()
        await vi.waitFor(() => expect(harness.drive).toHaveBeenCalledOnce())
      }
      expect(onboarding.activeId.value).toBe('ajustes-plan')
      expect(navigate).not.toHaveBeenCalled()
      await nextTick()
      expect(help.visible.value).toBe(false)
    } finally { scope.stop() }
  })

  it('termina Plan cuando los bloques opcionales no se han cargado', async () => {
    goToPlan()
    const handlers: ((event: { key: string; target: null; preventDefault: () => void }) => void)[] = []
    vi.stubGlobal('document', { body: {}, querySelector: (selector: string) => selector === TOUR_SELECTORS.settingsPlanRefresh ? { isConnected: true, getClientRects: () => [{}] } : null })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), addEventListener: (_name: string, callback: typeof handlers[number]) => handlers.push(callback), removeEventListener: vi.fn() })
    expect(await onboarding.startTour('ajustes-plan')).toBe(true)
    handlers.at(-1)!({ key: 'ArrowRight', target: null, preventDefault: vi.fn() })
    await vi.waitFor(() => expect(onboarding.activeId.value).toBeNull(), { timeout: 2500 })
    expect(onboarding.isCompleted('ajustes-plan')).toBe(true)
    expect(onboarding.pendingTour.value).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each(Object.entries(MODULE_EDIT_TOURS))('inicia %s en el módulo actual y presenta su pestaña', async (tab, id) => {
    route.query.tab = tab
    route.fullPath = `/modulos/actual/editar?tab=${tab}`
    expect(await onboarding.startTour(id)).toBe(true)
    expect(onboarding.activeId.value).toBe(id)
    expect(harness.drive).toHaveBeenCalledOnce()
    expect(harness.createDriver).toHaveBeenCalledWith(expect.objectContaining({ disableActiveInteraction: true, steps: [expect.objectContaining({ popover: expect.objectContaining({ title: onboardingTours[id].steps[0]!.title }) })] }))
    expect(onboarding.pendingTour.value?.originPath).toBe(route.fullPath)
    expect(navigate).not.toHaveBeenCalled()
    expect(planRefresh).not.toHaveBeenCalled()
  })

  it('rechaza una pestaña distinta, una ruta ajena y la falta de permiso', async () => {
    expect(await onboarding.startTour('editar-campos')).toBe(false)
    route.path = '/modulos/nuevo'
    expect(await onboarding.startTour('editar-flujo')).toBe(false)
    route.path = '/modulos/actual/editar'
    admin.value = false
    expect(await onboarding.startTour('editar-flujo')).toBe(false)
    expect(harness.drive).not.toHaveBeenCalled()
  })

  it.each(Object.entries(MODULE_EDIT_TOURS))('el botón de %s inicia su recorrido y sigue disponible tras descartar el aviso', async (tab, id) => {
    route.query.tab = tab
    route.fullPath = `/modulos/actual/editar?tab=${tab}`
    vi.stubGlobal('useOnboarding', () => onboarding)
    const help = useModuleTourHelp(tab as keyof typeof MODULE_EDIT_TOURS)
    expect(help.available.value).toBe(true)
    expect(await help.launch()).toBe(true)
    expect(onboarding.activeId.value).toBe(id)
    expect(help.disabled.value).toBe(true)
    expect(await help.launch()).toBe(false)
    expect(harness.drive).toHaveBeenCalledOnce()
    const original = route.fullPath
    route.fullPath = '/modulos'
    route.path = '/modulos'
    onboarding.handleRouteChange()
    route.fullPath = original
    route.path = '/modulos/actual/editar'
    expect(help.available.value).toBe(true)
    expect(help.disabled.value).toBe(false)
    expect(localStorage.getItem(`flow-chattito-help:t:u:module-edit:${tab}:dismissed`)).toBe('1')
    expect(await help.launch()).toBe(true)
    expect(harness.drive).toHaveBeenCalledTimes(2)
  })

  it('el botón respeta permisos, ruta y otro recorrido activo', async () => {
    vi.stubGlobal('useOnboarding', () => onboarding)
    const help = useModuleTourHelp('flow')
    admin.value = false
    expect(help.available.value).toBe(false)
    expect(await help.launch()).toBe(false)
    admin.value = true
    onboarding.activeId.value = 'bienvenida'
    expect(help.disabled.value).toBe(true)
    expect(await help.launch()).toBe(false)
    onboarding.activeId.value = null
    route.path = '/modulos/nuevo'
    expect(help.available.value).toBe(false)
    expect(await help.launch()).toBe(false)
    expect(harness.drive).not.toHaveBeenCalled()
  })

  it('pausa al cambiar de pestaña y reanuda en la URL original desde otra instancia', async () => {
    const original = route.fullPath
    await onboarding.startTour('editar-flujo')
    route.query.tab = 'fields'
    route.fullPath = '/modulos/actual/editar?tab=fields'
    const routeWatcher = useOnboarding()
    routeWatcher.handleRouteChange()
    expect(onboarding.activeId.value).toBeNull()
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'resume-tour', tourId: 'editar-flujo' } }))
    expect(await routeWatcher.resumeTour()).toBe(true)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(original)
    expect(route.fullPath).toBe(original)
    expect(routeWatcher.activeId.value).toBe('editar-flujo')
  })

  it('reanuda al salir del módulo y permite omitir el recorrido nuevo', async () => {
    const original = route.fullPath
    await onboarding.startTour('editar-flujo')
    route.path = '/modulos'
    route.fullPath = '/modulos'
    onboarding.handleRouteChange()
    expect(onboarding.pendingTour.value?.id).toBe('editar-flujo')
    expect(await onboarding.resumeTour('editar-flujo')).toBe(true)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(original)
    onboarding.omitTour()
    expect(onboarding.pendingTour.value).toBeNull()
    expect(onboarding.activeId.value).toBeNull()
  })

  it('salta zonas opcionales sin atascarse con el flujo desactivado', async () => {
    const original = route.fullPath
    await onboarding.startTour('editar-flujo')
    states.get('onboarding-active-index')!.value = 2
    states.get('onboarding-progress-memory')!.value = { 'flow-onboarding:t:u:editar-flujo:progress': { id: 'editar-flujo', index: 2, branch: null, originPath: original } }
    onboarding.handleRouteChange()
    const present = new Set<string>([TOUR_SELECTORS.editTabFlow, TOUR_SELECTORS.editFlowSetup, TOUR_SELECTORS.editFlowSave])
    vi.stubGlobal('document', { body: {}, querySelector: (selector: string) => present.has(selector) ? { isConnected: true, getClientRects: () => [{}] } : null })
    expect(await onboarding.resumeTour('editar-flujo')).toBe(true)
    expect(onboarding.activeIndex.value).toBe(5)
    expect(harness.createDriver).toHaveBeenLastCalledWith(expect.objectContaining({ steps: [expect.objectContaining({ popover: expect.objectContaining({ title: 'Guarda el flujo' }) })] }))
  })

  it('avanza, vuelve sobre los opcionales ausentes y termina sin modificar datos', async () => {
    const keyboardHandlers: ((event: { key: string; target: null; preventDefault: () => void }) => void)[] = []
    const present = new Set<string>([TOUR_SELECTORS.editTabFlow, TOUR_SELECTORS.editFlowSetup, TOUR_SELECTORS.editFlowSave])
    vi.stubGlobal('document', { body: {}, querySelector: (selector: string) => present.has(selector) ? { isConnected: true, getClientRects: () => [{}] } : null })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), addEventListener: (_name: string, callback: typeof keyboardHandlers[number]) => keyboardHandlers.push(callback), removeEventListener: vi.fn() })
    const press = (key: string) => keyboardHandlers.at(-1)!({ key, target: null, preventDefault: vi.fn() })
    await onboarding.startTour('editar-flujo')
    press('ArrowRight')
    await vi.waitFor(() => expect(harness.createDriver).toHaveBeenCalledTimes(2))
    expect(onboarding.activeIndex.value).toBe(1)
    press('ArrowRight')
    await vi.waitFor(() => expect(harness.createDriver).toHaveBeenCalledTimes(3), { timeout: 2000 })
    expect(onboarding.activeIndex.value).toBe(5)
    press('ArrowLeft')
    await vi.waitFor(() => expect(harness.createDriver).toHaveBeenCalledTimes(4))
    expect(onboarding.activeIndex.value).toBe(1)
    press('ArrowRight')
    await vi.waitFor(() => expect(harness.createDriver).toHaveBeenCalledTimes(5), { timeout: 2000 })
    press('ArrowRight')
    expect(onboarding.activeId.value).toBeNull()
    expect(onboarding.pendingTour.value).toBeNull()
    expect(onboarding.isCompleted('editar-flujo')).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('completa la cadena aviso → ayuda → infraestructura y no repite el aviso al pausar', async () => {
    const { effectScope, watch } = await import('vue')
    const scope = effectScope()
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useChattitoContext', () => ({ context: computed(() => resolveChattitoContext(route)) }))
    vi.stubGlobal('useChattitoHelpPreferences', () => ({ ready: ref(true), disabled: ref(false), setDisabled: vi.fn() }))
    vi.stubGlobal('useOnboarding', () => onboarding)
    try {
      const help = scope.run(useChattitoHelp)!
      expect(help.visible.value).toBe(true)
      expect(help.tourId.value).toBe('editar-flujo')
      help.runTour()
      await vi.waitFor(() => expect(harness.drive).toHaveBeenCalledOnce())
      expect(harness.drive).toHaveBeenCalledOnce()
      expect(onboarding.activeId.value).toBe('editar-flujo')
      route.path = '/modulos'
      route.fullPath = '/modulos'
      onboarding.handleRouteChange()
      await nextTick()
      expect(help.visible.value).toBe(false)
    } finally { scope.stop() }
  })
})
