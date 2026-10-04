import { chattitoSessionIdentity, type ChattitoEmotion } from '~/utils/chattito'
import { MODULE_EDIT_TABS, normalizeModuleEditTab, type ModuleEditTab } from './moduleEditTabs'

export const MODULE_EDIT_TOURS = {
  info: 'editar-info', fields: 'editar-campos', relations: 'editar-relaciones',
  menu: 'editar-menu', detail: 'editar-detalle', list: 'editar-listado',
  flow: 'editar-flujo', labels: 'editar-etiquetas', api: 'editar-api'
} as const satisfies Record<ModuleEditTab, string>

export const MODULE_EDIT_TAB_ANCHORS = {
  basica: 'edit-tab-info', campos: 'edit-tab-fields', relaciones: 'edit-tab-relations',
  navegacion: 'edit-tab-menu', detalle: 'edit-tab-detail', listado: 'edit-tab-list',
  flujo: 'edit-tab-flow', etiquetas: 'edit-tab-labels', api: 'edit-tab-api'
} as const satisfies Record<keyof typeof MODULE_EDIT_TABS, string>

export const SETTINGS_TOURS = { plan: 'ajustes-plan' } as const

export const TOUR_SELECTORS = {
  sitesAgendaSettings: '[data-tour="sites-agenda-settings"]',
  sitesAgendaCatalog: '[data-tour="sites-agenda-catalog"]',
  sitesAgendaPreview: '[data-tour="sites-agenda-preview"]',
  settingsPlanRefresh: '[data-tour="settings-plan-refresh"]',
  settingsPlanCurrent: '[data-tour="settings-plan-current"]',
  settingsPlanConsumption: '[data-tour="settings-plan-consumption"]',
  settingsPlanLimits: '[data-tour="settings-plan-limits"]',
  settingsPlanStorage: '[data-tour="settings-plan-storage"]',
  settingsPlanAvailable: '[data-tour="settings-plan-available"]',
  settingsPlanHistory: '[data-tour="settings-plan-history"]',
  editTabInfo: '[data-tour="edit-tab-info"]',
  editTabFields: '[data-tour="edit-tab-fields"]',
  editTabRelations: '[data-tour="edit-tab-relations"]',
  editTabMenu: '[data-tour="edit-tab-menu"]',
  editTabDetail: '[data-tour="edit-tab-detail"]',
  editTabList: '[data-tour="edit-tab-list"]',
  editTabFlow: '[data-tour="edit-tab-flow"]',
  editTabLabels: '[data-tour="edit-tab-labels"]',
  editTabApi: '[data-tour="edit-tab-api"]',
  editInfoIdentity: '[data-tour="edit-info-identity"]',
  editInfoActive: '[data-tour="edit-info-active"]',
  editInfoSave: '[data-tour="edit-info-save"]',
  editFieldsAdd: '[data-tour="edit-fields-add"]',
  editFieldsRows: '[data-tour="edit-fields-rows"]',
  editFieldsPreview: '[data-tour="edit-fields-preview"]',
  editRelationsAdd: '[data-tour="edit-relations-add"]',
  editRelationsRows: '[data-tour="edit-relations-rows"]',
  editMenuContext: '[data-tour="edit-menu-context"]',
  editMenuGroup: '[data-tour="edit-menu-group"]',
  editMenuSave: '[data-tour="edit-menu-save"]',
  editDetailProperties: '[data-tour="edit-detail-properties"]',
  editDetailRelations: '[data-tour="edit-detail-relations"]',
  editDetailActivity: '[data-tour="edit-detail-activity"]',
  editDetailPreview: '[data-tour="edit-detail-preview"]',
  editDetailSave: '[data-tour="edit-detail-save"]',
  editListViews: '[data-tour="edit-list-views"]',
  editListTable: '[data-tour="edit-list-table"]',
  editListPreview: '[data-tour="edit-list-preview"]',
  editListSave: '[data-tour="edit-list-save"]',
  editFlowSetup: '[data-tour="edit-flow-setup"]',
  editFlowTransitions: '[data-tour="edit-flow-transitions"]',
  editFlowMap: '[data-tour="edit-flow-map"]',
  editFlowLock: '[data-tour="edit-flow-lock"]',
  editFlowSave: '[data-tour="edit-flow-save"]',
  editLabelsToggle: '[data-tour="edit-labels-toggle"]',
  editLabelsFields: '[data-tour="edit-labels-fields"]',
  editLabelsPreview: '[data-tour="edit-labels-preview"]',
  editLabelsSave: '[data-tour="edit-labels-save"]',
  editApiConnection: '[data-tour="edit-api-connection"]',
  editApiOperations: '[data-tour="edit-api-operations"]',
  editApiExample: '[data-tour="edit-api-example"]',
  editApiFields: '[data-tour="edit-api-fields"]',
  editApiPermissions: '[data-tour="edit-api-permissions"]',
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
  manualFieldAdd: '[data-tour="manual-field-add"]',
  manualFieldModal: '[data-tour="manual-field-modal"]',
  manualFieldLabel: '[data-tour="manual-field-label"]',
  manualFieldType: '[data-tour="manual-field-type"]',
  manualFieldRequired: '[data-tour="manual-field-required"]',
  manualFieldOptions: '[data-tour="manual-field-options"]',
  manualFieldSave: '[data-tour="manual-field-save"]',
  manualFieldCancel: '[data-tour="manual-field-cancel"]',
  manualFieldSaved: '[data-tour="manual-field-saved"]',
  manualFieldsContinue: '[data-tour="manual-fields-continue"]',
  manualDetailSave: '[data-tour="manual-detail-save"]',
  manualListSave: '[data-tour="manual-list-save"]',
} as const

export type ModuleEditTourId = typeof MODULE_EDIT_TOURS[ModuleEditTab]
export type TourId = 'sites-agenda' | 'bienvenida' | 'primer-modulo' | 'crear-modulo-manual' | ModuleEditTourId | typeof SETTINGS_TOURS[keyof typeof SETTINGS_TOURS]

export function isModuleEditTour(id: TourId | null): id is ModuleEditTourId {
  return Object.values(MODULE_EDIT_TOURS).some(tourId => tourId === id)
}

export function moduleEditTourMatchesRoute(id: ModuleEditTourId, path: string, tab: unknown) {
  return /^\/modulos\/[^/]+\/editar\/?$/.test(path) && MODULE_EDIT_TOURS[normalizeModuleEditTab(tab)] === id
}
// Recorridos informativos que permanecen en la URL donde se iniciaron.
export function isContextualTour(id: TourId | null) {
  return isModuleEditTour(id) || id === SETTINGS_TOURS.plan || id === 'sites-agenda'
}

export function contextualTourMatchesRoute(id: TourId, path: string, query: Record<string, unknown>) {
  if (id === 'sites-agenda') return /^\/sites\/[^/]+\/agenda\/?$/.test(path)
  return isModuleEditTour(id) ? moduleEditTourMatchesRoute(id, path, query.tab)
    : id === SETTINGS_TOURS.plan && /^\/ajustes\/?$/.test(path) && query.section === 'plan'
}

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
  interactive?: boolean
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
  return step.waitForClick === true || step.interactive === true || Boolean(step.completeWhen)
}

export function isManualFieldModalStep(id: TourId, step: OnboardingStep) {
  return id === 'crear-modulo-manual' && Boolean(step.selector && [TOUR_SELECTORS.manualFieldLabel, TOUR_SELECTORS.manualFieldType, TOUR_SELECTORS.manualFieldRequired, TOUR_SELECTORS.manualFieldOptions, TOUR_SELECTORS.manualFieldSave].some(selector => selector === step.selector))
}

export function manualStepIndex(selector: OnboardingStep['selector']) {
  return onboardingTours['crear-modulo-manual'].steps.findIndex(step => step.selector === selector)
}

export function manualFieldExitIndex(saved: boolean) {
  return manualStepIndex(saved ? TOUR_SELECTORS.manualFieldsContinue : TOUR_SELECTORS.manualFieldAdd)
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
export interface TourProgress { id: TourId; index: number; branch: TourBranch; originPath: string; version?: 2 }

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
  return index === manualStepIndex(TOUR_SELECTORS.manualDetailSave) ? 'campos' : index === manualStepIndex(TOUR_SELECTORS.manualListSave) ? 'detalle' : null
}

export function previousTourIndex(id: TourId, index: number, branch: TourBranch) {
  return id === 'primer-modulo' && index === 4 && branch === 'designer' ? 2 : index - 1
}

export function tourStepDestination(id: TourId, index: number, step: OnboardingStep, originPath: string) {
  if (isContextualTour(id)) return originPath
  return id === 'primer-modulo' && index < 2 ? originPath : step.path
}

export const onboardingTours: Record<TourId, OnboardingTour> = {
  'sites-agenda': { id: 'sites-agenda', requires: ['settings.modules'], steps: [
    { selector: TOUR_SELECTORS.sitesAgendaSettings, title: 'Agenda del sitio', text: 'Activa la agenda cuando Citas base y los horarios del personal estén listos. Guarda para aplicar los cambios.', side: 'bottom', emotion: 'idle' },
    { selector: TOUR_SELECTORS.sitesAgendaCatalog, title: 'Servicios y personal visibles', text: 'Busca y selecciona los servicios y las personas que aparecerán en tu sitio. Una lista vacía permite todos los disponibles.', side: 'bottom', emotion: 'idle' },
    { selector: TOUR_SELECTORS.sitesAgendaPreview, title: 'Prueba sin reservar', text: 'Esta vista usa datos simulados y nunca crea citas. Inserta el componente o un botón modal desde el editor de páginas.', side: 'top', emotion: 'happy' }
  ] },
  'ajustes-plan': {
    id: 'ajustes-plan', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.settingsPlanRefresh, title: 'Tu plan, a la vista', text: 'Aquí revisas el plan y el consumo de tu organización. Actualizar vuelve a consultar los datos; este recorrido solo te los explica.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.settingsPlanCurrent, title: 'El plan actual', text: 'Aquí ves el plan, su estado y el precio mostrado. Cambiar plan te lleva a comparar opciones, sin elegir ninguna por ti.', side: 'bottom', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.settingsPlanConsumption, title: 'Consumo del periodo', text: 'Compara lo utilizado con lo incluido. Las barras y porcentajes te ayudan a reconocer los recursos que se acercan al límite.', side: 'bottom', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.settingsPlanLimits, title: 'Límites del plan', text: 'Este bloque muestra el consumo del mes calendario. Ilimitado indica que ese concepto no tiene un máximo en el plan.', side: 'bottom', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.settingsPlanStorage, title: 'Espacio para tus archivos', text: 'Revisa cuánto almacenamiento utilizas y cuánto queda disponible. Incluye archivos del chat, imágenes de sitios y documentos.', side: 'bottom', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.settingsPlanAvailable, title: 'Compara antes de cambiar', text: 'Aquí comparas precios y beneficios mensuales o anuales. Una opción puede estar bloqueada si tu consumo supera sus límites; tú decides si quieres iniciar un cambio.', side: 'top', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.settingsPlanHistory, title: 'Facturas e historial', text: 'Aquí ves los cobros registrados y descargas las facturas que tengan enlace. Debajo, Historial de consumo reúne las últimas muestras disponibles. ¡Ya sabes dónde revisar!', side: 'top', emotion: 'happy', optional: true },
    ]
  },
  'editar-info': {
    id: 'editar-info', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabInfo, title: 'Información general', text: 'Aquí ajustas la identidad y disponibilidad del módulo que tienes abierto. Vamos por partes.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editInfoIdentity, title: 'Así reconocerás tu módulo', text: 'Cambia el nombre y la descripción; el nombre en singular identifica cada registro. El icono se elige junto al título y la ruta se conserva.', side: 'right', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editInfoActive, title: '¿Está disponible?', text: 'Módulo activo controla su disponibilidad. Si está deshabilitado, sus registros siguen disponibles para consulta.', side: 'top', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editInfoSave, title: 'Guarda cuando estés a gusto', text: 'Guardar cambios aplica tus ajustes. Este recorrido solo te muestra dónde está cada cosa.', side: 'top', emotion: 'happy' },
    ]
  },
  'editar-campos': {
    id: 'editar-campos', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabFields, title: 'Los datos de tus registros', text: 'En Campos defines qué información guardará cada registro, como una fecha, un importe o una lista de opciones.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editFieldsAdd, title: 'Un dato nuevo', text: 'Agregar campo abre el formulario para elegir etiqueta, tipo de dato y si es obligatorio. No hace falta agregar nada para seguir conmigo.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editFieldsRows, title: 'Edita y ordena', text: 'Aquí están tus campos. Puedes editarlos o arrastrarlos para cambiar su orden; cada cambio se guarda desde esta pantalla.', side: 'right', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.editFieldsPreview, title: 'Mira cómo va quedando', text: 'La vista previa muestra el módulo con sus campos actuales. ¡Ya tienes el mapa para empezar!', side: 'left', emotion: 'happy' },
    ]
  },
  'editar-relaciones': {
    id: 'editar-relaciones', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabRelations, title: 'Conecta tus módulos', text: 'Aquí configuras tipos de vínculo con otros módulos. Los registros se vinculan después, desde su ficha.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editRelationsAdd, title: 'Define un vínculo', text: 'Nueva relación permite darle nombre al vínculo y elegir el módulo relacionado. Está disponible cuando hay otro módulo activo para elegir.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editRelationsRows, title: 'Revisa los vínculos existentes', text: 'La lista muestra con qué módulos te vinculas y desde cuáles te vinculan. Aquí puedes renombrar o quitar un tipo de relación.', side: 'top', emotion: 'happy', optional: true },
    ]
  },
  'editar-menu': {
    id: 'editar-menu', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabMenu, title: 'Un lugar fácil de encontrar', text: 'Esta pestaña organiza la ubicación del módulo en el menú operativo.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editMenuContext, title: 'Módulos y catálogos', text: 'Los módulos pueden agruparse en el menú. Los catálogos se consultan desde los selectores y no aparecen en el menú operativo.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editMenuGroup, title: 'Elige o crea un grupo', text: 'Elige un grupo existente o usa Crear grupo para escribir su nombre y elegir un icono. Sin grupo deja el módulo fuera de esos grupos.', side: 'right', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.editMenuSave, title: 'Aplica la ubicación', text: 'Guardar ubicación aplica el grupo elegido. El acceso a los datos y la visibilidad por rol se configuran en Roles y permisos.', side: 'top', emotion: 'happy', optional: true },
    ]
  },
  'editar-detalle': {
    id: 'editar-detalle', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabDetail, title: 'La ficha de un registro', text: 'En Diseño del detalle decides qué información aparece al abrir un registro.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editDetailProperties, title: 'Propiedades a la vista', text: 'Muestra u oculta propiedades y arrástralas para cambiar su orden. Si aún no hay campos, aquí verás el aviso.', side: 'right', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editDetailRelations, title: 'También las relaciones', text: 'Cuando otros módulos apuntan a este, aquí decides si aparecen sus tablas, su orden y si permiten edición.', side: 'right', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editDetailActivity, title: 'La historia del registro', text: 'Mostrar línea de tiempo de actividad incluye los cambios y notas en la ficha.', side: 'top', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editDetailPreview, title: 'Revisa la ficha', text: 'Esta vista previa usa tu diseño para que puedas comprobar cómo se verá la información.', side: 'left', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editDetailSave, title: 'Tu diseño, guardado', text: 'Guardar diseño aplica estos ajustes. Puedes revisarlos antes de guardar; recorrerlos no cambia datos.', side: 'bottom', emotion: 'happy' },
    ]
  },
  'editar-listado': {
    id: 'editar-listado', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabList, title: 'La lista de tus registros', text: 'Aquí configuras cómo se consulta el módulo: columnas, filtros, orden y vistas disponibles.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editListViews, title: 'Tabla, tablero y calendario', text: 'Tabla siempre está activa. En Kanban y Calendario puedes configurar sus campos y activar esas vistas cuando las necesites.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editListTable, title: 'Columnas, filtros y orden', text: 'En Tabla eliges las columnas visibles, las arrastras para ordenarlas y defines filtros y el orden inicial.', side: 'right', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.editListPreview, title: 'Una mirada antes de guardar', text: 'La vista previa muestra el diseño de la vista seleccionada con los campos del módulo.', side: 'left', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editListSave, title: 'Aplica tu diseño', text: 'Guardar diseño conserva la configuración del listado, el tablero y el calendario.', side: 'bottom', emotion: 'happy' },
    ]
  },
  'editar-flujo': {
    id: 'editar-flujo', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabFlow, title: 'El recorrido de tus registros', text: 'Flujo de estados define qué cambios de estado se permiten y quién puede realizarlos.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editFlowSetup, title: 'Empieza por los estados', text: 'Activa el flujo, elige un campo Select y el estado inicial. Sus opciones serán los estados; si no tienes ese campo, agrégalo en Campos. Con el flujo desactivado seguimos directamente al guardado.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editFlowTransitions, title: 'Transiciones y roles', text: 'Elige origen, destino y rol para cada transición. La lista reúne las reglas que permitirán cambiar de estado.', side: 'right', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.editFlowMap, title: 'Acomoda el mapa', text: 'Arrastra los estados para acomodarlos o el asa + para conectarlos. Reacomodar restablece su ubicación; las flechas muestran las transiciones configuradas. Sin estados, el mapa te pide elegir un campo.', side: 'left', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.editFlowLock, title: 'Bloqueo por estado', text: 'Decide si el registro puede modificarse en cada estado y qué campos conservan edición cuando está bloqueado.', side: 'top', emotion: 'idle', optional: true },
      { selector: TOUR_SELECTORS.editFlowSave, title: 'Guarda el flujo', text: 'Guardar flujo aplica las reglas en el servidor o conserva su desactivación. ¡Listo, tú decides cuándo hacerlo!', side: 'bottom', emotion: 'happy' },
    ]
  },
  'editar-etiquetas': {
    id: 'editar-etiquetas', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabLabels, title: 'Una etiqueta para tus registros', text: 'Aquí preparas el diseño que se usará al imprimir etiquetas de este módulo.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editLabelsToggle, title: 'Activa la impresión', text: 'Activa o desactiva las etiquetas. Si tu organización tiene logo, también puedes incluirlo.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editLabelsFields, title: 'Tamaño y contenido', text: 'Elige formato, orientación, copias y los campos de título, texto secundario y código de barras. Debajo puedes incluir hasta cuatro datos adicionales.', side: 'right', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editLabelsPreview, title: 'Revisa la etiqueta', text: 'La vista previa muestra tu diseño. La impresión respeta las medidas reales en milímetros.', side: 'left', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editLabelsSave, title: 'Conserva el diseño', text: 'Guardar etiqueta aplica el diseño y si la impresión está activa o desactivada.', side: 'bottom', emotion: 'happy' },
    ]
  },
  'editar-api': {
    id: 'editar-api', requires: ['settings.modules'], steps: [
      { selector: TOUR_SELECTORS.editTabApi, title: 'Conecta otras herramientas', text: 'API reúne documentación y ejemplos para integrar los registros del módulo. Solo vamos a revisarlos.', side: 'bottom', emotion: 'happy' },
      { selector: TOUR_SELECTORS.editApiConnection, title: 'Dirección y autenticación', text: 'Aquí está el endpoint del módulo y el encabezado Bearer que necesita una clave de acceso.', side: 'bottom', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editApiOperations, title: 'Elige una operación', text: 'Puedes consultar los ejemplos para listar, consultar, crear, actualizar o eliminar registros.', side: 'right', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editApiExample, title: 'Un ejemplo para compartir', text: 'Copiar lleva el ejemplo al portapapeles. Quien prepare la integración debe sustituir la clave de acceso y el identificador del registro antes de ejecutarlo.', side: 'left', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editApiFields, title: 'Los campos disponibles', text: 'Aquí consultas las claves, tipos y campos requeridos. Los datos viajan en customData y Flow genera el id.', side: 'top', emotion: 'idle' },
      { selector: TOUR_SELECTORS.editApiPermissions, title: 'Los permisos también cuentan', text: 'Estas operaciones dependen de los permisos de tu usuario. ¡Ya sabes dónde consultar lo necesario para una integración!', side: 'top', emotion: 'happy' },
    ]
  },
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
      { selector: TOUR_SELECTORS.manualFieldAdd, title: 'Agrega un campo', text: 'Un campo guarda un dato, como “Fecha” o “Importe”. Presiona Agregar campo y te explico cada parte del formulario.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { selector: TOUR_SELECTORS.manualFieldModal }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldLabel, title: '¿Cómo llamarás este dato?', text: 'Escribe la Etiqueta visible que reconocerás en el módulo. El Nombre técnico se propone solo; puedes ajustarlo si hace falta.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', interactive: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldType, title: 'Elige el Tipo de dato', text: 'Texto para palabras, Número o Monto para cifras, Fecha para días, Select para una lista, Relación para otro módulo y Archivo para adjuntos. Elige el que necesites.', side: 'left', emotion: 'idle', path: '/modulos/nuevo', interactive: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldRequired, title: '¿Debe ser obligatorio?', text: 'Campo obligatorio exige completar el dato. Según el tipo, también puedes poner límites en Reglas de validación; déjalos vacíos si no los necesitas.', side: 'left', emotion: 'idle', path: '/modulos/nuevo', interactive: true, optional: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldOptions, title: 'Opciones de la lista', text: 'Si elegiste Select, agrega aquí las Opciones que podrá escoger la gente y decide si admite una o varias.', side: 'left', emotion: 'idle', path: '/modulos/nuevo', interactive: true, optional: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldSave, title: 'Guarda tu campo', text: 'Cuando termines, presiona Agregar campo. Tu campo aparecerá en la lista; Cancelar cierra el formulario sin guardarlo.', side: 'top', emotion: 'idle', path: '/modulos/nuevo', interactive: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualFieldsContinue, title: 'Revisa tus campos', text: 'Ya tienes tu primer campo. Puedes agregar más si los necesitas; luego presiona Continuar para acomodar la ficha de cada registro.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', waitForClick: true, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualDetailSave, title: 'Diseño del detalle', text: 'Esta es la ficha de un registro. Acomoda aquí la información que quieres mostrar y presiona Guardar diseño para seguir.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { selector: TOUR_SELECTORS.manualListSave }, requires: 'settings.modules' },
      { selector: TOUR_SELECTORS.manualListSave, title: 'Diseño del listado', text: 'Elige las columnas y filtros de la lista. Al presionar Guardar diseño, el módulo queda listo y vuelves a Módulos de Core.', side: 'bottom', emotion: 'idle', path: '/modulos/nuevo', completeWhen: { path: '/modulos' }, requires: 'settings.modules' },
      { kind: 'offer-designer', title: '¡Ya quedó tu módulo!', text: 'Lo hiciste a mano. ¿Quieres ver cómo el Diseñador de estructura puede preparar una propuesta para el próximo?', side: 'bottom', emotion: 'happy', path: '/modulos', optional: true, requires: 'designer', action: { label: 'Ir al Diseñador', path: '/disenador' } },
    ],
  },
}

export interface WaitForTourTargetOptions { timeoutMs?: number; intervalMs?: number; abort?: () => boolean }

export async function waitForTourTarget(find: () => Element | null, isVisible: (element: Element) => boolean, options: WaitForTourTargetOptions = {}): Promise<Element | null> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  do {
    if (options.abort?.()) return null
    const element = find()
    if (element && isVisible(element)) return element
    if (Date.now() >= deadline) return null
    await new Promise<void>(resolve => setTimeout(resolve, intervalMs))
  } while (Date.now() <= deadline)
  return null
}

export function watchTourTargetRemoval(root: Node, target: Element, onRemoved: () => void) {
  const observer = new MutationObserver(() => {
    if (!target.isConnected) {
      observer.disconnect()
      onRemoved()
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
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

export function manualResumeIndex(index: number, draft: ManualWizardDraft | null, modalOpen = false, fieldSaved = false) {
  if (!draft || index < 2 || index === onboardingTours['crear-modulo-manual'].steps.length - 1) return index
  if (draft.step === 'listado') return manualStepIndex(TOUR_SELECTORS.manualListSave)
  if (draft.step === 'detalle') return manualStepIndex(TOUR_SELECTORS.manualDetailSave)
  if (index >= manualStepIndex(TOUR_SELECTORS.manualFieldsContinue)) return manualStepIndex(TOUR_SELECTORS.manualFieldsContinue)
  if (isManualFieldModalStep('crear-modulo-manual', onboardingTours['crear-modulo-manual'].steps[index]!) && modalOpen) return index
  return fieldSaved ? manualStepIndex(TOUR_SELECTORS.manualFieldsContinue) : manualStepIndex(TOUR_SELECTORS.manualFieldAdd)
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
    if (id === 'crear-modulo-manual' && progress.version !== 2 && index >= 4 && index <= 7) {
      return { ...progress, index: index + 5, version: 2 } as TourProgress
    }
    return progress as TourProgress
  } catch { return null }
}

export function writeTourProgress(storage: Pick<Storage, 'setItem'>, key: string, progress: TourProgress) {
  try { storage.setItem(key, JSON.stringify(progress.id === 'crear-modulo-manual' ? { ...progress, version: 2 } : progress)) } catch { /* El progreso sigue en memoria. */ }
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
