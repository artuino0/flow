import { chattitoSessionIdentity, type ChattitoEmotion } from '~/utils/chattito'

export const TOUR_SELECTORS = {
  dashboard: '[data-tour="dashboard"]',
  menu: '[data-tour="menu"]',
  notifications: '[data-tour="notifications"]',
  chattito: '[data-tour="chattito"]',
  account: '[data-tour="account"]',
  accountMenu: '[data-tour="account-menu"]',
  accountSettings: '[data-tour="account-settings"]',
  modulesCore: '[data-tour="modules-core"]',
  designerAccess: '[data-tour="designer-access"]',
  designer: '[data-tour="designer"]',
  designerPrompt: '[data-tour="designer-prompt"]',
  designerCanvas: '[data-tour="designer-canvas"]',
  designerReview: '[data-tour="designer-review"]',
  manualCreate: '[data-tour="manual-create"]',
  manualBasic: '[data-tour="manual-basic"]',
  manualFields: '[data-tour="manual-fields"]',
  manualFieldSaved: '[data-tour="manual-field-saved"]',
  manualFieldsContinue: '[data-tour="manual-fields-continue"]',
  manualDetailSave: '[data-tour="manual-detail-save"]',
  manualListSave: '[data-tour="manual-list-save"]',
} as const

export type TourId = 'bienvenida' | 'primer-modulo' | 'crear-modulo-manual'
export type TourSide = 'top' | 'right' | 'bottom' | 'left'
export type TourRequirement = 'settings.modules' | 'designer'
export interface OnboardingStep {
  selector?: typeof TOUR_SELECTORS[keyof typeof TOUR_SELECTORS]
  kind?: 'choice' | 'offer-designer'
  title: string
  text: string
  side: TourSide
  emotion: ChattitoEmotion
  path?: string
  waitForClick?: boolean
  completeWhen?: { selector: string } | { path: string }
  action?: { label: string; path: string }
  optional?: boolean
  requires?: TourRequirement
}
export interface OnboardingTour { id: TourId; requires: readonly TourRequirement[]; steps: readonly OnboardingStep[] }

export interface TourAccess { isAdmin: boolean; designerAvailable: boolean }

export function meetsTourRequirement(requirement: TourRequirement, access: TourAccess) {
  // useIsAdmin consulta /api/roles, la misma fuente que AppNav y Ajustes;
  // /api/module-designer/sessions exige requireAdminRole y AppNav usa el plan.
  return requirement === 'settings.modules' ? access.isAdmin : access.isAdmin && access.designerAvailable
}

export function permittedTourSteps(tour: OnboardingTour, access: TourAccess) {
  return tour.steps.filter(step => !step.requires || meetsTourRequirement(step.requires, access))
}

export function canRunTour(tour: OnboardingTour, access: TourAccess) {
  return tour.requires.every(requirement => meetsTourRequirement(requirement, access))
    && tour.steps.every(step => step.optional || !step.requires || meetsTourRequirement(step.requires, access))
}

export function onboardingSessionIdentity(user: { authenticated: boolean; id: string; tenantId: string; sessionId?: string; roleId?: string | null } | null | undefined) {
  const session = chattitoSessionIdentity(user)
  return session ? JSON.stringify([session, user?.roleId ?? null]) : null
}

export function tourAdvance(step: OnboardingStep, index: number, total: number) {
  if (step.kind === 'choice') return { kind: 'choice' as const }
  if (step.kind === 'offer-designer') return { kind: 'offer-designer' as const }
  if (step.completeWhen) return { kind: 'wait-action' as const }
  if (step.action) return { kind: 'navigate' as const, label: step.action.label, path: step.action.path }
  if (step.waitForClick) return { kind: 'wait-click' as const }
  return index === total - 1
    ? { kind: 'finish' as const, label: 'Listo' }
    : { kind: 'next' as const, label: 'Siguiente' }
}

export function allowsTourTargetClick(step: OnboardingStep) {
  return step.waitForClick === true || Boolean(step.completeWhen)
}

export function tourNeedsAdministration(id: TourId | null, sectionKey: string) {
  return (id === 'primer-modulo' || id === 'crear-modulo-manual') && sectionKey === 'administration'
}

export function showDesignerAccess(planCode: string | undefined) {
  return Boolean(planCode && planCode !== 'agenda')
}

export function tourNeedsMobileMenu(path: string, id: TourId | null, index: number, isMobile: boolean) {
  return isMobile && path === '/ajustes' && ((id === 'primer-modulo' && index >= 2 && index <= 4) || (id === 'crear-modulo-manual' && index === 0))
}

export function destroyTourDriver(instance: { destroy: () => void } | undefined) {
  instance?.destroy()
}

export const TOUR_POPOVER_CONTROLS = { showButtons: ['close'] as const, showProgress: true }

export type TourBranch = 'manual' | 'designer' | null
export interface TourProgress { id: TourId; index: number; branch: TourBranch; originPath: string }

export function nextTourIndex(id: TourId, index: number, branch: TourBranch) {
  return id === 'primer-modulo' && index === 2 ? branch === 'designer' ? 4 : 3 : index + 1
}

export function tourChoiceDestination(branch: Exclude<TourBranch, null>) {
  return branch === 'manual'
    ? { tourId: 'crear-modulo-manual' as const, index: 0 }
    : { tourId: 'primer-modulo' as const, index: 4 }
}

export const MANUAL_TOUR_BACK_EVENT = 'flow:manual-tour-back'

export function manualTourBackStage(index: number): 'campos' | 'detalle' | null {
  return index === 5 ? 'campos' : index === 6 ? 'detalle' : null
}

export function previousTourIndex(id: TourId, index: number, branch: TourBranch) {
  return id === 'primer-modulo' && index === 4 && branch === 'designer' ? 2 : index - 1
}

export function tourStepDestination(id: TourId, index: number, step: OnboardingStep, originPath: string) {
  return id === 'primer-modulo' && index < 2 ? originPath : step.path
}

export const onboardingTours: Record<TourId, OnboardingTour> = {
  bienvenida: {
    id: 'bienvenida',
    requires: [],
    steps: [
      { selector: TOUR_SELECTORS.dashboard, title: '¡Qué gusto tenerte en Flow!', text: 'Este es el resumen de tu operación. Todo va tomando forma desde aquí.', side: 'bottom', emotion: 'happy', optional: true },
      { selector: TOUR_SELECTORS.menu, title: 'Tus herramientas, a la mano', text: 'Desde este menú llegas a tus módulos y a las herramientas disponibles para tu cuenta.', side: 'right', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.modulesCore, title: 'Módulos de Core', text: 'Si administras módulos, aquí los puedes crear y organizar. Sin hacer malabares.', side: 'right', emotion: 'idle', optional: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.notifications, title: 'Aquí te aviso', text: 'La campanita guarda tus notificaciones. Si algo se mueve, te enteras por acá.', side: 'left', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.chattito, title: 'Y aquí ando yo', text: 'Abre el panel cuando quieras. Ahí puedes volver a estos recorridos; prometo no hacer examen al final.', side: 'left', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.account, title: 'Tu cuenta', text: 'Aquí están tus ajustes y el cierre de sesión. ¡Listo, ya tienes el mapa!', side: 'left', emotion: 'happy', optional: true },
    ],
  },
  'primer-modulo': {
    id: 'primer-modulo',
    requires: ['settings.modules', 'designer'],
    steps: [
      { selector: TOUR_SELECTORS.account, title: 'Vamos paso a paso', text: 'Primero, presiona sobre tu nombre. Te espero aquí; sin atajos mágicos.', side: 'left', emotion: 'happy', waitForClick: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.accountSettings, title: 'Ahora sí, Ajustes', text: 'En el menú que se abrió, entra a Ajustes y seguimos desde ahí.', side: 'left', emotion: 'idle', waitForClick: true, requires: 'settings.modules' },
      { kind: 'choice', title: 'Tú eliges cómo empezar', text: '¿Cómo prefieres crear tu módulo? Te enseño la ruta manual o te acompaño en el Diseñador de estructura. Tú mandas.', side: 'bottom', emotion: 'happy', path: '/ajustes', requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.modulesCore, title: 'Módulos de Core', text: 'Aquí, en Módulos de Core, puedes crear tus módulos manualmente. Está en la sección Administración del menú.', side: 'right', emotion: 'idle', path: '/ajustes', requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.designerAccess, title: '¿Vemos el Diseñador?', text: 'Si quieres, te ayudo en el Diseñador de estructura para armar una propuesta. También puedes seguir por la ruta manual.', side: 'right', emotion: 'happy', path: '/ajustes', action: { label: 'Ir al Diseñador', path: '/disenador' }, requires: 'designer' },
      { selector: TOUR_SELECTORS.designer, title: 'Ya estamos en el Diseñador', text: 'Aquí puedes preparar la estructura de tus módulos antes de crearla. Te enseño dónde está cada cosa.', side: 'left', emotion: 'happy', path: '/disenador', requires: 'designer' },
      { selector: TOUR_SELECTORS.designerPrompt, title: 'Empieza con una idea', text: 'Describe lo que necesitas y revisa la propuesta. Enviar una idea consume créditos; seguir este recorrido no.', side: 'right', emotion: 'idle', path: '/disenador', requires: 'designer' },
      { selector: TOUR_SELECTORS.designerCanvas, title: 'Este es el plano', text: 'Aquí aparece tu estructura. Puedes revisar módulos, campos y relaciones antes de crear nada.', side: 'left', emotion: 'idle', path: '/disenador', requires: 'designer' },
      { selector: TOUR_SELECTORS.designerReview, title: 'Tú decides cuándo crear', text: 'La revisión final aparece cuando tengas una propuesta. Nada se crea por seguir este recorrido.', side: 'left', emotion: 'happy', path: '/disenador', requires: 'designer' },
    ],
  },
  'crear-modulo-manual': {
    id: 'crear-modulo-manual',
    requires: ['settings.modules'],
    steps: [
      { selector: TOUR_SELECTORS.modulesCore, title: 'Vamos a Módulos de Core', text: 'Un módulo reúne la información de un tema de tu negocio. Presiona Módulos de Core para crear el tuyo; yo te acompaño.', side: 'right', emotion: 'happy', path: '/ajustes', completeWhen: { path: '/modulos' }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualCreate, title: 'Crea un módulo', text: 'Aquí están los módulos de tu organización. Presiona Crear módulo para abrir el asistente; el límite de tu plan se revisa antes de entrar.', side: 'bottom', emotion: 'idle', path: '/modulos', completeWhen: { path: '/modulos/nuevo' }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualBasic, title: 'Ponle nombre', text: 'Escribe el nombre del módulo. La dirección corta se propone sola; la descripción y el nombre en singular son opcionales. Cuando estés a gusto, presiona Continuar.', side: 'right', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { selector: TOUR_SELECTORS.manualFields }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFields, title: 'Agrega un campo', text: 'Un campo guarda un dato, como “Fecha” o “Importe”. Presiona Agregar campo, escribe su etiqueta, elige el tipo de dato y guárdalo. Yo espero a que aparezca en la lista.', side: 'right', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { selector: TOUR_SELECTORS.manualFieldSaved }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldsContinue, title: 'Revisa tus campos', text: 'Ya tienes tu primer campo. Puedes agregar más si los necesitas; luego presiona Continuar para acomodar la ficha de cada registro.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', waitForClick: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualDetailSave, title: 'Diseño del detalle', text: 'Esta es la ficha de un registro. Acomoda aquí la información que quieres mostrar y presiona Guardar diseño para seguir.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { selector: TOUR_SELECTORS.manualListSave }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualListSave, title: 'Diseño del listado', text: 'Elige las columnas y filtros de la lista. Al presionar Guardar diseño, el módulo queda listo y vuelves a Módulos de Core.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { path: '/modulos' }, requires: 'settings.modules' },
      { kind: 'offer-designer', title: '¡Ya quedó tu módulo!', text: 'Lo hiciste a mano. ¿Quieres ver cómo el Diseñador de estructura puede preparar una propuesta para el próximo?', side: 'bottom', emotion: 'happy', path: '/modulos', optional: true, requires: 'designer', action: { label: 'Ir al Diseñador', path: '/disenador' } },
    ],
  },
}

export interface WaitForTourTargetOptions { timeoutMs?: number; intervalMs?: number }

export async function waitForTourTarget(find: () => Element | null, isVisible: (element: Element) => boolean, options: WaitForTourTargetOptions = {}): Promise<Element | null> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  do {
    const element = find()
    if (element && isVisible(element)) return element
    if (Date.now() >= deadline) return null
    await new Promise<void>(resolve => setTimeout(resolve, intervalMs))
  } while (Date.now() <= deadline)
  return null
}

export const TOUR_TARGET_FAILURE_MESSAGE = 'Parece que esa pantalla no terminó de cargar. Te dejo seguir por tu cuenta; cuando quieras, retomamos el recorrido.'

export function visibleTourSteps(tour: OnboardingTour, root: Pick<Document, 'querySelector'>, isVisible: (element: Element) => boolean) {
  return tour.steps.flatMap(step => {
    if (!step.selector) return []
    const element = root.querySelector(step.selector)
    return element && isVisible(element) ? [{ ...step, element }] : []
  })
}

export function canStartOnboarding(user: { authenticated: boolean; emailVerified?: boolean; onboardingStatus?: string } | null | undefined, routePath: string, layout: unknown, developmentLab = false) {
  return Boolean(user?.authenticated && user.emailVerified && user.onboardingStatus === 'complete' && (layout !== false || (developmentLab && routePath === '/dev/chattito')))
}

export function canStartTourRequest(id: TourId, user: { authenticated: boolean; emailVerified?: boolean; onboardingStatus?: string } | null | undefined, routePath: string, layout: unknown, access: TourAccess, developmentLab = false) {
  return canStartOnboarding(user, routePath, layout, developmentLab) && canRunTour(onboardingTours[id], access)
}

export function tourStorageKey(tenantId: string, userId: string, tourId: TourId) {
  return `flow-onboarding:${tenantId}:${userId}:${tourId}`
}

export function tourDismissalKey(tenantId: string, userId: string, tourId: TourId) {
  return `${tourStorageKey(tenantId, userId, tourId)}:dismissed`
}

export function tourProgressKey(tenantId: string, userId: string, tourId: TourId) {
  return `${tourStorageKey(tenantId, userId, tourId)}:progress`
}

export function manualWizardStorageKey(tenantId: string, userId: string) {
  return `${tourStorageKey(tenantId, userId, 'crear-modulo-manual')}:wizard`
}

export interface ManualWizardDraft { entityId: string; name: string; slug: string; step: 'campos' | 'detalle' | 'listado' }

export function manualResumeIndex(index: number, draft: ManualWizardDraft | null) {
  if (!draft || index < 2 || index === 7) return index
  if (draft.step === 'listado') return 6
  if (draft.step === 'detalle') return 5
  return index <= 3 ? 3 : 4
}

export function readManualWizardDraft(storage: Pick<Storage, 'getItem'>, key: string): ManualWizardDraft | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const draft = value as Partial<ManualWizardDraft>
    return typeof draft.entityId === 'string' && draft.entityId.length > 0
      && typeof draft.name === 'string' && draft.name.length > 0
      && typeof draft.slug === 'string' && draft.slug.length > 0
      && (draft.step === 'campos' || draft.step === 'detalle' || draft.step === 'listado')
      ? draft as ManualWizardDraft : null
  } catch { return null }
}

export function writeManualWizardDraft(storage: Pick<Storage, 'setItem'>, key: string, draft: ManualWizardDraft) {
  try { storage.setItem(key, JSON.stringify(draft)) } catch { /* Se conserva la etapa en memoria mientras la pantalla esté abierta. */ }
}

export function readTourProgress(storage: Pick<Storage, 'getItem'>, key: string, id: TourId): TourProgress | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const progress = value as Partial<TourProgress>
    const index = progress.index
    if (progress.id !== id || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= onboardingTours[id].steps.length) return null
    if (progress.branch !== null && progress.branch !== 'manual' && progress.branch !== 'designer') return null
    if (typeof progress.originPath !== 'string' || !progress.originPath.startsWith('/') || progress.originPath.startsWith('//')) return null
    return progress as TourProgress
  } catch { return null }
}

export function writeTourProgress(storage: Pick<Storage, 'setItem'>, key: string, progress: TourProgress) {
  try { storage.setItem(key, JSON.stringify(progress)) } catch { /* El progreso sigue en memoria. */ }
}

export function clearTourProgress(storage: Pick<Storage, 'removeItem'>, key: string) {
  try { storage.removeItem(key) } catch { /* El progreso se descartó en memoria. */ }
}

export function readTourCompletion(storage: Pick<Storage, 'getItem'>, key: string) {
  try { return storage.getItem(key) === '1' } catch { return false }
}

export function writeTourCompletion(storage: Pick<Storage, 'setItem'>, key: string) {
  try { storage.setItem(key, '1') } catch { /* El recorrido sigue completado en memoria. */ }
}

export function shouldResetOnboarding(current: string | null | undefined, previous: string | null | undefined) {
  return !current || Boolean(previous && current !== previous)
}
