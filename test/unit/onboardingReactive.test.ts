import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref, type Ref } from 'vue'
import { useOnboarding } from '../../composables/useOnboarding'
import { MODULE_EDIT_TOURS, onboardingTours, tourProgressKey } from '../../utils/onboardingTours'

vi.mock('../../components/ChattitoAvatar.vue', () => ({ default: {} }))
vi.mock('driver.js', () => ({ driver: vi.fn() }))

describe('estado compartido y pausa de recorridos', () => {
  let states: Map<string, Ref>
  let addMessage: ReturnType<typeof vi.fn>
  let admin: Ref<boolean>
  let route: { path: string; fullPath: string; query: { tab: string }; meta: { layout: string } }

  beforeEach(() => {
    states = new Map()
    addMessage = vi.fn()
    admin = ref(true)
    route = reactive({ path: '/modulos/1/editar', fullPath: '/modulos/1/editar?tab=flow', query: { tab: 'flow' }, meta: { layout: 'default' } })
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)
    })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useAuth', () => ({ user: ref({ authenticated: true, id: 'u', tenantId: 't', sessionId: 's', emailVerified: true, onboardingStatus: 'complete' }) }))
    vi.stubGlobal('useIsAdmin', () => ({ data: admin, status: ref('success') }))
    vi.stubGlobal('useDesignerPlanUsage', () => ({ data: ref({ code: 'agenda' }), status: ref('success') }))
    vi.stubGlobal('useChattitoPanel', () => ({ panel: ref({ open: false }), addMessage }))
    vi.stubGlobal('useToast', () => ({ error: vi.fn() }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('la instancia que vigila la ruta pausa el recorrido iniciado desde otra instancia', () => {
    const launcher = useOnboarding()
    const watcher = useOnboarding()
    launcher.activeId.value = 'editar-flujo'
    launcher.activeIndex.value = 2
    states.get('onboarding-active-steps')!.value = onboardingTours['editar-flujo'].steps
    watcher.handleRouteChange()
    expect(launcher.activeId.value).toBeNull()
    expect(states.get('onboarding-active-steps')!.value).toEqual([])
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'resume-tour', tourId: 'editar-flujo' } }))
  })

  it('conserva la transición por ruta del recorrido manual entre instancias', () => {
    const launcher = useOnboarding()
    const watcher = useOnboarding()
    launcher.activeId.value = 'crear-modulo-manual'
    launcher.activeIndex.value = 1
    states.get('onboarding-active-steps')!.value = onboardingTours['crear-modulo-manual'].steps
    route.path = '/modulos/nuevo'
    watcher.handleRouteChange()
    expect(launcher.activeId.value).toBe('crear-modulo-manual')
    expect(addMessage).not.toHaveBeenCalled()
    route.path = '/otra-pantalla'
    watcher.handleRouteChange()
    expect(launcher.activeId.value).toBeNull()
    expect(addMessage).toHaveBeenCalledOnce()
  })

  it.each(Object.values(MODULE_EDIT_TOURS))('ofrece el progreso de %s y conserva la URL completa', id => {
    const onboarding = useOnboarding()
    const progress = { id, index: 1, branch: null, originPath: '/modulos/1/editar?tab=flow' }
    states.get('onboarding-progress-memory')!.value = { [tourProgressKey('t', 'u', id)]: progress }
    expect(onboarding.pendingTour.value).toEqual(progress)
    admin.value = false
    expect(onboarding.pendingTour.value).toBeNull()
    expect(onboarding.canLaunchTour(id)).toBe(false)
  })

  it('mantiene la prioridad de los recorridos previos al agregar los nuevos', () => {
    const onboarding = useOnboarding()
    const old = { id: 'crear-modulo-manual', index: 1, branch: null, originPath: '/ajustes' }
    const edit = { id: 'editar-info', index: 1, branch: null, originPath: '/modulos/1/editar?tab=info' }
    states.get('onboarding-progress-memory')!.value = {
      [tourProgressKey('t', 'u', 'crear-modulo-manual')]: old,
      [tourProgressKey('t', 'u', 'editar-info')]: edit,
      [tourProgressKey('t', 'u', 'ajustes-plan')]: { id: 'ajustes-plan', index: 1, branch: null, originPath: '/ajustes?section=plan' }
    }
    expect(onboarding.pendingTour.value).toEqual(old)
    delete states.get('onboarding-progress-memory')!.value[tourProgressKey('t', 'u', 'crear-modulo-manual')]
    expect(onboarding.pendingTour.value).toEqual(edit)
  })
})
