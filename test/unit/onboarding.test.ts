import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { chattitoSessionIdentity } from '../../utils/chattito'
import { MODULE_EDIT_TOURS, MODULE_EDIT_TAB_ANCHORS } from '../../utils/onboardingTours'
import { TOUR_SELECTORS, TOUR_POPOVER_CONTROLS, allowsTourTargetClick, canRunTour, canStartOnboarding, canStartTourRequest, clearTourProgress, destroyTourDriver, isManualFieldModalStep, manualFieldExitIndex, manualResumeIndex, manualStepIndex, manualTourBackStage, manualWizardStorageKey, nextTourIndex, onboardingSessionIdentity, onboardingTours, permittedTourSteps, previousTourIndex, readManualWizardDraft, readTourCompletion, readTourProgress, shouldResetOnboarding, showDesignerAccess, TOUR_TARGET_FAILURE_MESSAGE, tourAdvance, tourChoiceDestination, tourDismissalKey, tourNeedsAdministration, tourNeedsMobileMenu, tourProgressKey, tourStepDestination, tourStorageKey, visibleTourSteps, waitForTourTarget, writeManualWizardDraft, writeTourCompletion, writeTourProgress } from '../../utils/onboardingTours'

describe('definiciones de recorridos', () => {
  it('tiene IDs únicos, textos útiles y selectores declarados', () => {
    const tours = Object.values(onboardingTours)
    expect(new Set(tours.map(tour => tour.id)).size).toBe(tours.length)
    expect(tours.map(tour => tour.id)).toEqual(['sites-agenda', 'ajustes-plan', ...Object.values(MODULE_EDIT_TOURS), 'bienvenida', 'primer-modulo', 'crear-modulo-manual'])
    for (const tour of tours) {
      expect(tour.steps.length).toBeGreaterThan(0)
      for (const step of tour.steps) {
        expect(step.title.trim()).not.toBe('')
        expect(step.text.trim()).not.toBe('')
        if (step.kind === 'choice' || step.kind === 'offer-designer') expect(step.selector).toBeUndefined()
        else expect(Object.values(TOUR_SELECTORS)).toContain(step.selector)
      }
    }
  })

  it('guía primer módulo con acciones en orden antes de abrir el diseñador', () => {
    const steps = onboardingTours['primer-modulo'].steps
    expect(steps.map(step => step.selector)).toEqual([
      TOUR_SELECTORS.account,
      TOUR_SELECTORS.accountSettings,
      undefined,
      TOUR_SELECTORS.modulesCore,
      TOUR_SELECTORS.designerAccess,
      TOUR_SELECTORS.designer,
      TOUR_SELECTORS.designerPrompt,
      TOUR_SELECTORS.designerCanvas,
      TOUR_SELECTORS.designerReview,
    ])
    expect(steps.map((step, index) => tourAdvance(step, index, steps.length).kind)).toEqual([
      'wait-click', 'wait-click', 'choice', 'next', 'navigate', 'next', 'next', 'next', 'finish',
    ])
    expect(steps[0]?.waitForClick).toBe(true)
    expect(steps[1]?.waitForClick).toBe(true)
    expect(steps[2]?.text).toContain('ruta manual')
    expect(steps[2]?.kind).toBe('choice')
    expect(tourChoiceDestination('manual')).toEqual({ tourId: 'crear-modulo-manual', index: 0 })
    expect(tourChoiceDestination('designer')).toEqual({ tourId: 'primer-modulo', index: 4 })
    expect(steps[3]?.text).toContain('crear tus módulos manualmente')
    expect(tourAdvance(steps[3]!, 3, steps.length)).toEqual({ kind: 'next', label: 'Siguiente' })
    expect(steps[2]?.path).toBe('/ajustes')
    expect(steps[0]?.path).toBeUndefined()
    expect(steps[4]?.action).toEqual({ label: 'Ir al Diseñador', path: '/disenador' })
    expect(steps[4]?.text).toContain('Diseñador de estructura')
    expect(steps.slice(0, 5).every(step => !step.optional)).toBe(true)
    expect([0, 1, 2, 3, 4].map(index => steps[index]?.title)).toEqual([
      'Vamos paso a paso', 'Ahora sí, Ajustes', 'Tú eliges cómo empezar', 'Módulos de Core', '¿Vemos el Diseñador?',
    ])
    expect(nextTourIndex('primer-modulo', 2, 'manual')).toBe(3)
    expect(nextTourIndex('primer-modulo', 3, 'manual')).toBe(4)
    expect(nextTourIndex('primer-modulo', 2, 'designer')).toBe(4)
    expect(previousTourIndex('primer-modulo', 4, 'designer')).toBe(2)
    expect(previousTourIndex('primer-modulo', 4, 'manual')).toBe(3)
    expect(steps.map(allowsTourTargetClick)).toEqual([true, true, false, false, false, false, false, false, false])
    expect(steps.map((step, index) => tourStepDestination('primer-modulo', index, step, '/inicio'))).toEqual([
      '/inicio', '/inicio', '/ajustes', '/ajustes', '/ajustes', '/disenador', '/disenador', '/disenador', '/disenador',
    ])
  })

  it('explica el modal de campo antes de continuar la creación manual', () => {
    const steps = onboardingTours['crear-modulo-manual'].steps
    expect(steps).toHaveLength(13)
    expect(steps.map(step => step.selector)).toEqual([
      TOUR_SELECTORS.modulesCore, TOUR_SELECTORS.manualCreate, TOUR_SELECTORS.manualBasic,
      TOUR_SELECTORS.manualFieldAdd, TOUR_SELECTORS.manualFieldLabel, TOUR_SELECTORS.manualFieldType,
      TOUR_SELECTORS.manualFieldRequired, TOUR_SELECTORS.manualFieldOptions, TOUR_SELECTORS.manualFieldSave,
      TOUR_SELECTORS.manualFieldsContinue,
      TOUR_SELECTORS.manualDetailSave, TOUR_SELECTORS.manualListSave, undefined,
    ])
    expect(steps.map(step => step.path)).toEqual([
      '/ajustes', '/modulos', '/modulos/nuevo', '/modulos/nuevo',
      '/modulos/nuevo', '/modulos/nuevo', '/modulos/nuevo', '/modulos/nuevo',
      '/modulos/nuevo', '/modulos/nuevo', '/modulos/nuevo', '/modulos/nuevo', '/modulos',
    ])
    expect(steps.map((step, index) => tourAdvance(step, index, steps.length).kind)).toEqual([
      'wait-action', 'wait-action', 'wait-action', 'wait-action',
      'next', 'next', 'next', 'next', 'next',
      'wait-click', 'wait-action', 'wait-action', 'offer-designer',
    ])
    expect(steps[0]?.completeWhen).toEqual({ path: '/modulos' })
    expect(steps[1]?.completeWhen).toEqual({ path: '/modulos/nuevo' })
    expect(steps[2]?.completeWhen).toEqual({ selector: TOUR_SELECTORS.manualFields })
    expect(steps[3]?.completeWhen).toEqual({ selector: TOUR_SELECTORS.manualFieldModal })
    expect(steps[3]?.text).not.toContain('ya lo tengo')
    expect(steps.slice(4, 9).every(step => step.interactive)).toBe(true)
    expect(steps.slice(4, 9).every(step => isManualFieldModalStep('crear-modulo-manual', step))).toBe(true)
    expect(steps[6]?.optional).toBe(true)
    expect(steps[7]?.optional).toBe(true)
    expect(steps[10]?.completeWhen).toEqual({ selector: TOUR_SELECTORS.manualListSave })
    expect(steps[11]?.completeWhen).toEqual({ path: '/modulos' })
    expect(steps[12]?.action).toEqual({ label: 'Ir al Diseñador', path: '/disenador' })
    expect(steps.slice(0, 12).every(step => step.requires === 'settings.modules')).toBe(true)
    expect(steps[12]?.requires).toBe('designer')
    expect(steps[12]?.optional).toBe(true)
    expect(steps.map(allowsTourTargetClick)).toEqual([true, true, true, true, true, true, true, true, true, true, true, true, false])
    expect(manualTourBackStage(10)).toBe('campos')
    expect(manualTourBackStage(11)).toBe('detalle')
    expect(manualTourBackStage(3)).toBeNull()
    expect(manualStepIndex(TOUR_SELECTORS.manualFieldAdd)).toBe(3)
    expect(manualFieldExitIndex(false)).toBe(3)
    expect(manualFieldExitIndex(true)).toBe(9)
  })

  it('solo ofrece el recorrido completo a quien tiene acceso a Ajustes y al Diseñador', () => {
    const admin = { isAdmin: true, designerAvailable: true }
    const member = { isAdmin: false, designerAvailable: false }
    expect(canRunTour(onboardingTours['primer-modulo'], admin)).toBe(true)
    expect(permittedTourSteps(onboardingTours['primer-modulo'], admin)).toHaveLength(9)
    expect(canRunTour(onboardingTours['primer-modulo'], member)).toBe(false)
    expect(permittedTourSteps(onboardingTours['primer-modulo'], member)).toHaveLength(0)
    expect(canRunTour(onboardingTours['primer-modulo'], { isAdmin: true, designerAvailable: false })).toBe(false)
    const user = { authenticated: true, emailVerified: true, onboardingStatus: 'complete' }
    expect(canStartTourRequest('primer-modulo', user, '/', 'default', admin)).toBe(true)
    expect(canStartTourRequest('primer-modulo', user, '/', 'default', member)).toBe(false)
    expect(canStartTourRequest('primer-modulo', user, '/', 'default', { isAdmin: true, designerAvailable: false })).toBe(false)
    expect(canStartTourRequest('crear-modulo-manual', user, '/', 'default', admin)).toBe(true)
    expect(canStartTourRequest('crear-modulo-manual', user, '/', 'default', member)).toBe(false)
    expect(canStartTourRequest('crear-modulo-manual', user, '/', 'default', { isAdmin: true, designerAvailable: false })).toBe(true)
    expect(permittedTourSteps(onboardingTours['crear-modulo-manual'], { isAdmin: true, designerAvailable: false })).toHaveLength(12)
    const panel = readFileSync(new URL('../../components/ChattitoPanel.vue', import.meta.url), 'utf8')
    expect(panel).toContain('v-if="canLaunchTour(\'primer-modulo\')"')
    expect(panel).toContain('v-if="canLaunchTour(\'crear-modulo-manual\')"')
  })

  it('la bienvenida omite el paso de administración y su texto para un miembro', () => {
    const adminSteps = permittedTourSteps(onboardingTours.bienvenida, { isAdmin: true, designerAvailable: true })
    const memberSteps = permittedTourSteps(onboardingTours.bienvenida, { isAdmin: false, designerAvailable: false })
    expect(adminSteps.some(step => step.selector === TOUR_SELECTORS.modulesCore)).toBe(true)
    expect(memberSteps.some(step => step.selector === TOUR_SELECTORS.modulesCore)).toBe(false)
    expect(memberSteps.map(step => step.text).join(' ')).not.toContain('Si administras módulos')
    expect(canRunTour(onboardingTours.bienvenida, { isAdmin: false, designerAvailable: false })).toBe(true)
  })

  it('cada selector data-tour existe en la plantilla que lo ofrece', () => {
    const sourceByName: Record<keyof typeof TOUR_SELECTORS, string> = {
      sitesAgendaSettings: 'pages/sites/[siteId]/agenda/index.vue',
      sitesAgendaCatalog: 'pages/sites/[siteId]/agenda/index.vue',
      sitesAgendaPreview: 'pages/sites/[siteId]/agenda/index.vue',
      settingsPlanRefresh: 'pages/ajustes/index.vue',
      settingsPlanCurrent: 'components/SettingsBillingSummary.vue',
      settingsPlanConsumption: 'components/SettingsBillingSummary.vue',
      settingsPlanLimits: 'components/SettingsBillingSummary.vue',
      settingsPlanStorage: 'components/SettingsBillingSummary.vue',
      settingsPlanAvailable: 'components/SettingsBillingSummary.vue',
      settingsPlanHistory: 'components/SettingsBillingSummary.vue',
      dashboard: 'pages/index.vue',
      menu: 'layouts/default.vue',
      notifications: 'components/NotificationCenter.vue',
      chattito: 'components/ChattitoToggle.vue',
      account: 'layouts/default.vue',
      accountMenu: 'layouts/default.vue',
      accountSettings: 'layouts/default.vue',
      modulesCore: 'components/AppNav.vue',
      designerAccess: 'components/AppNav.vue',
      designer: 'pages/disenador.vue',
      designerPrompt: 'pages/disenador.vue',
      designerCanvas: 'pages/disenador.vue',
      designerReview: 'pages/disenador.vue',
      manualCreate: 'components/ModuleListing.vue',
      manualBasic: 'components/ModuleWizard.vue',
      manualFields: 'components/ModuleWizard.vue',
      manualFieldAdd: 'components/ModuleFieldsCard.vue',
      manualFieldModal: 'components/FieldFormModal.vue',
      manualFieldLabel: 'components/FieldFormModal.vue',
      manualFieldType: 'components/FieldFormModal.vue',
      manualFieldRequired: 'components/FieldFormModal.vue',
      manualFieldOptions: 'components/FieldFormModal.vue',
      manualFieldSave: 'components/FieldFormModal.vue',
      manualFieldCancel: 'components/FieldFormModal.vue',
      manualFieldSaved: 'components/ModuleFieldsCard.vue',
      manualFieldsContinue: 'components/ModuleWizard.vue',
      manualDetailSave: 'components/ModuleWizard.vue',
      manualListSave: 'components/ModuleWizard.vue',
      editTabInfo: 'pages/modulos/[id]/editar.vue',
      editTabFields: 'pages/modulos/[id]/editar.vue',
      editTabRelations: 'pages/modulos/[id]/editar.vue',
      editTabMenu: 'pages/modulos/[id]/editar.vue',
      editTabDetail: 'pages/modulos/[id]/editar.vue',
      editTabList: 'pages/modulos/[id]/editar.vue',
      editTabFlow: 'pages/modulos/[id]/editar.vue',
      editTabLabels: 'pages/modulos/[id]/editar.vue',
      editTabApi: 'pages/modulos/[id]/editar.vue',
      editInfoIdentity: 'pages/modulos/[id]/editar.vue',
      editInfoActive: 'pages/modulos/[id]/editar.vue',
      editInfoSave: 'pages/modulos/[id]/editar.vue',
      editFieldsAdd: 'components/ModuleFieldsCard.vue',
      editFieldsRows: 'components/ModuleFieldsCard.vue',
      editFieldsPreview: 'pages/modulos/[id]/editar.vue',
      editRelationsAdd: 'components/ModuleRelationsCard.vue',
      editRelationsRows: 'components/ModuleRelationsCard.vue',
      editMenuContext: 'pages/modulos/[id]/editar.vue',
      editMenuGroup: 'components/ModuleNavigationEditor.vue',
      editMenuSave: 'components/ModuleNavigationEditor.vue',
      editDetailProperties: 'components/ModuleDetailLayoutCard.vue',
      editDetailRelations: 'components/ModuleDetailLayoutCard.vue',
      editDetailActivity: 'components/ModuleDetailLayoutCard.vue',
      editDetailPreview: 'pages/modulos/[id]/editar.vue',
      editDetailSave: 'pages/modulos/[id]/editar.vue',
      editListViews: 'components/ModuleListLayoutCard.vue',
      editListTable: 'components/ModuleListLayoutCard.vue',
      editListPreview: 'components/ModuleListLayoutCard.vue',
      editListSave: 'pages/modulos/[id]/editar.vue',
      editFlowSetup: 'components/ModuleStateWorkflowCard.vue',
      editFlowTransitions: 'components/ModuleStateWorkflowCard.vue',
      editFlowMap: 'components/ModuleStateWorkflowCard.vue',
      editFlowLock: 'components/ModuleStateWorkflowCard.vue',
      editFlowSave: 'components/ModuleStateWorkflowCard.vue',
      editLabelsToggle: 'components/ModuleLabelEditor.vue',
      editLabelsFields: 'components/ModuleLabelEditor.vue',
      editLabelsPreview: 'components/ModuleLabelEditor.vue',
      editLabelsSave: 'pages/modulos/[id]/editar.vue',
      editApiConnection: 'components/ModuleApiDocs.vue',
      editApiOperations: 'components/ModuleApiDocs.vue',
      editApiExample: 'components/ModuleApiDocs.vue',
      editApiFields: 'components/ModuleApiDocs.vue',
      editApiPermissions: 'components/ModuleApiDocs.vue',
    }
    for (const [name, selector] of Object.entries(TOUR_SELECTORS) as [keyof typeof TOUR_SELECTORS, string][]) {
      const file = new URL(`../../${sourceByName[name]}`, import.meta.url)
      const stableName = selector.match(/data-tour="([^"]+)"/)?.[1]
      expect(stableName).toBeTruthy()
      const source = readFileSync(file, 'utf8')
      if (name.startsWith('editTab')) {
        expect(Object.values(MODULE_EDIT_TAB_ANCHORS)).toContain(stableName)
        expect(source).toContain(':data-tour="MODULE_EDIT_TAB_ANCHORS[tab.key]"')
      } else expect(source).toContain(stableName!)
    }
  })

  it('omite elementos ausentes u ocultos sin alterar el orden', () => {
    const visible = {} as Element
    const hidden = {} as Element
    const root = { querySelector: (selector: string) => selector === TOUR_SELECTORS.menu ? visible : selector === TOUR_SELECTORS.notifications ? hidden : null } as Pick<Document, 'querySelector'>
    const steps = visibleTourSteps(onboardingTours.bienvenida, root, element => element === visible)
    expect(steps.map(step => step.selector)).toEqual([TOUR_SELECTORS.menu])
  })
})

describe('espera de destinos del recorrido', () => {
  it('espera con reintentos a que aparezca el modal después de Agregar campo', async () => {
    vi.useFakeTimers()
    try {
      const modal = {} as Element
      let mounted = false
      const result = waitForTourTarget(() => mounted ? modal : null, () => true, { timeoutMs: 500, intervalMs: 50 })
      await vi.advanceTimersByTimeAsync(100)
      mounted = true
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toBe(modal)
    } finally { vi.useRealTimers() }
  })

  it('deja de esperar un control cuando el modal se cierra entre pasos', async () => {
    vi.useFakeTimers()
    try {
      let modalOpen = true
      const result = waitForTourTarget(() => null, () => true, { timeoutMs: 8_000, intervalMs: 50, abort: () => !modalOpen })
      await vi.advanceTimersByTimeAsync(100)
      modalOpen = false
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('espera a que el elemento aparezca tras navegar', async () => {
    vi.useFakeTimers()
    try {
      const element = {} as Element
      let path = '/'
      let mounted = false
      const result = waitForTourTarget(() => path === '/ajustes' && mounted ? element : null, () => true, { timeoutMs: 500, intervalMs: 50 })
      await vi.advanceTimersByTimeAsync(100)
      path = '/ajustes'
      await vi.advanceTimersByTimeAsync(50)
      mounted = true
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toBe(element)
    } finally { vi.useRealTimers() }
  })

  it('termina amablemente si el elemento no aparece', async () => {
    vi.useFakeTimers()
    try {
      const result = waitForTourTarget(() => null, () => true, { timeoutMs: 200, intervalMs: 50 })
      await vi.advanceTimersByTimeAsync(250)
      expect(await result).toBeNull()
      expect(TOUR_TARGET_FAILURE_MESSAGE).toMatch(/retomamos el recorrido/)
    } finally { vi.useRealTimers() }
  })

  it('espera la etapa de campos tras guardar la información básica', async () => {
    vi.useFakeTimers()
    try {
      const fields = {} as Element
      let stage: 'basica' | 'campos' = 'basica'
      const result = waitForTourTarget(() => stage === 'campos' ? fields : null, () => true, { timeoutMs: 500, intervalMs: 50 })
      await vi.advanceTimersByTimeAsync(150)
      stage = 'campos'
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toBe(fields)
    } finally { vi.useRealTimers() }
  })
})

describe('panel de Chattito durante los recorridos', () => {
  it('no cierra el panel y usa una carita quieta mientras el panel está abierto', () => {
    const source = readFileSync(new URL('../../composables/useOnboarding.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('closeChattito')
    expect(source).not.toMatch(/chattitoPanel\.value\.open\s*=/)
    expect(source).toContain('if (chattitoPanel.value.open)')
    expect(source).toContain('flow-tour__still-avatar')
  })
})

describe('visibilidad de los pasos en Ajustes', () => {
  it('mantiene abierta Administración y muestra el acceso al Diseñador durante el recorrido', () => {
    expect(tourNeedsAdministration('primer-modulo', 'administration')).toBe(true)
    expect(tourNeedsAdministration('crear-modulo-manual', 'administration')).toBe(true)
    expect(tourNeedsAdministration('bienvenida', 'administration')).toBe(false)
    expect(showDesignerAccess(undefined)).toBe(false)
    expect(showDesignerAccess('agenda')).toBe(false)
    expect(showDesignerAccess('pro')).toBe(true)
    expect(tourNeedsMobileMenu('/ajustes', 'primer-modulo', 2, true)).toBe(true)
    expect(tourNeedsMobileMenu('/ajustes', 'primer-modulo', 3, true)).toBe(true)
    expect(tourNeedsMobileMenu('/ajustes', 'primer-modulo', 4, true)).toBe(true)
    expect(tourNeedsMobileMenu('/ajustes', 'primer-modulo', 1, true)).toBe(false)
    expect(tourNeedsMobileMenu('/ajustes', 'primer-modulo', 2, false)).toBe(false)
    expect(tourNeedsMobileMenu('/ajustes', 'crear-modulo-manual', 0, true)).toBe(true)
  })

  it('destruye cada instancia de Driver.js al cambiar de paso', () => {
    const instance = { destroy: vi.fn() }
    destroyTourDriver(instance)
    expect(instance.destroy).toHaveBeenCalledOnce()
    expect(TOUR_POPOVER_CONTROLS).toEqual({ showButtons: ['close'], showProgress: true })
  })
})

describe('persistencia y sesión', () => {
  it('retoma la etapa del asistente manual sin compartirla con otro usuario y la descarta al terminar', () => {
    const entries = new Map<string, string>()
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) },
      removeItem: (key: string) => { entries.delete(key) },
    }
    const key = manualWizardStorageKey('org-1', 'usuario-1')
    const progressKey = tourProgressKey('org-1', 'usuario-1', 'crear-modulo-manual')
    writeTourProgress(storage, progressKey, { id: 'crear-modulo-manual', index: 5, branch: null, originPath: '/ajustes' })
    writeManualWizardDraft(storage, key, { entityId: 'mod-1', name: 'Pedidos', slug: 'pedidos', step: 'detalle' })
    expect(readTourProgress(storage, progressKey, 'crear-modulo-manual')?.index).toBe(5)
    expect(readManualWizardDraft(storage, key)).toEqual({ entityId: 'mod-1', name: 'Pedidos', slug: 'pedidos', step: 'detalle' })
    expect(manualResumeIndex(11, readManualWizardDraft(storage, key))).toBe(10)
    expect(manualResumeIndex(3, readManualWizardDraft(storage, key))).toBe(10)
    writeManualWizardDraft(storage, key, { entityId: 'mod-1', name: 'Pedidos', slug: 'pedidos', step: 'campos' })
    expect(manualResumeIndex(5, readManualWizardDraft(storage, key), true)).toBe(5)
    expect(manualResumeIndex(5, readManualWizardDraft(storage, key), false)).toBe(3)
    expect(manualResumeIndex(5, readManualWizardDraft(storage, key), false, true)).toBe(9)
    expect(manualResumeIndex(9, readManualWizardDraft(storage, key))).toBe(9)
    storage.setItem(progressKey, JSON.stringify({ id: 'crear-modulo-manual', index: 5, branch: null, originPath: '/ajustes' }))
    expect(readTourProgress(storage, progressKey, 'crear-modulo-manual')?.index).toBe(10)
    expect(readManualWizardDraft(storage, manualWizardStorageKey('org-1', 'usuario-2'))).toBeNull()
    expect(tourStepDestination('crear-modulo-manual', 10, onboardingTours['crear-modulo-manual'].steps[10]!, '/ajustes')).toBe('/modulos/nuevo')
    storage.removeItem(key)
    clearTourProgress(storage, progressKey)
    expect(readManualWizardDraft(storage, key)).toBeNull()
    expect(readTourProgress(storage, progressKey, 'crear-modulo-manual')).toBeNull()
    storage.setItem(key, '{mal formado')
    expect(readManualWizardDraft(storage, key)).toBeNull()
  })

  it('guarda rama, paso y origen por usuario, y permite retomar o descartar', () => {
    const entries = new Map<string, string>()
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) },
      removeItem: (key: string) => { entries.delete(key) },
    }
    const key = tourProgressKey('org-1', 'usuario-1', 'primer-modulo')
    const progress = { id: 'primer-modulo' as const, index: 4, branch: 'manual' as const, originPath: '/inicio' }
    writeTourProgress(storage, key, progress)
    expect(readTourProgress(storage, key, 'primer-modulo')).toEqual(progress)
    expect(readTourProgress(storage, tourProgressKey('org-1', 'usuario-2', 'primer-modulo'), 'primer-modulo')).toBeNull()
    expect(readTourProgress(storage, key, 'bienvenida')).toBeNull()
    clearTourProgress(storage, key)
    expect(readTourProgress(storage, key, 'primer-modulo')).toBeNull()
    storage.setItem(key, '{incorrecto')
    expect(readTourProgress(storage, key, 'primer-modulo')).toBeNull()
  })

  it('separa el progreso por usuario, organización y recorrido', () => {
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
    const key = tourStorageKey('org-1', 'usuario-1', 'bienvenida')
    writeTourCompletion(storage, key)
    expect(readTourCompletion(storage, key)).toBe(true)
    expect(readTourCompletion(storage, tourStorageKey('org-1', 'usuario-2', 'bienvenida'))).toBe(false)
    expect(readTourCompletion(storage, tourStorageKey('org-2', 'usuario-1', 'bienvenida'))).toBe(false)
    expect(readTourCompletion(storage, tourStorageKey('org-1', 'usuario-1', 'primer-modulo'))).toBe(false)
    const dismissed = tourDismissalKey('org-1', 'usuario-2', 'bienvenida')
    writeTourCompletion(storage, dismissed)
    expect(readTourCompletion(storage, dismissed)).toBe(true)
    expect(readTourCompletion(storage, tourStorageKey('org-1', 'usuario-2', 'bienvenida'))).toBe(false)
  })

  it('tolera localStorage inaccesible', () => {
    const storage = { getItem: () => { throw new Error('denegado') }, setItem: () => { throw new Error('denegado') } }
    expect(readTourCompletion(storage, 'x')).toBe(false)
    expect(() => writeTourCompletion(storage, 'x')).not.toThrow()
  })

  it('no inicia sin sesión, verificación o en rutas públicas', () => {
    const user = { authenticated: true, emailVerified: true, onboardingStatus: 'complete' }
    expect(canStartOnboarding(null, '/', 'default')).toBe(false)
    expect(canStartOnboarding({ ...user, authenticated: false }, '/', 'default')).toBe(false)
    expect(canStartOnboarding({ ...user, emailVerified: false }, '/', 'default')).toBe(false)
    expect(canStartOnboarding(user, '/login', false)).toBe(false)
    expect(canStartOnboarding(user, '/dev/chattito', false, true)).toBe(true)
    expect(canStartOnboarding(user, '/', 'default')).toBe(true)
  })

  it('reinicia al cerrar sesión o cambiar usuario, organización o sesión', () => {
    const user = { authenticated: true, id: 'u1', tenantId: 'o1', sessionId: 's1' }
    const current = chattitoSessionIdentity(user)
    expect(shouldResetOnboarding(current, null)).toBe(false)
    expect(shouldResetOnboarding(null, current)).toBe(true)
    expect(shouldResetOnboarding(chattitoSessionIdentity({ ...user, id: 'u2' }), current)).toBe(true)
    expect(shouldResetOnboarding(chattitoSessionIdentity({ ...user, tenantId: 'o2' }), current)).toBe(true)
    expect(shouldResetOnboarding(chattitoSessionIdentity({ ...user, sessionId: 's2' }), current)).toBe(true)
    const onboardingIdentity = onboardingSessionIdentity({ ...user, roleId: 'admin' })
    expect(shouldResetOnboarding(onboardingSessionIdentity({ ...user, roleId: 'member' }), onboardingIdentity)).toBe(true)
  })
})
