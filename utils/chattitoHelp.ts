import type { ChattitoContext } from './chattitoContext'
import type { ModuleEditTab } from './moduleEditTabs'
import { MODULE_EDIT_TOURS, meetsTourRequirement, type TourAccess, type TourId, type TourRequirement } from './onboardingTours'

export interface ChattitoHelp {
  title: string
  summary: string
  bullets?: readonly string[]
  tourId?: TourId
  requires: readonly TourRequirement[]
}

export type ChattitoHelpId = `module-edit:${ModuleEditTab}`

export const chattitoHelpCatalog: Readonly<Record<ChattitoHelpId, ChattitoHelp>> = {
  'module-edit:info': {
    tourId: MODULE_EDIT_TOURS.info,
    title: 'Información general', requires: ['settings.modules'],
    summary: 'Aquí puedes cambiar el nombre, la descripción, el icono y si el módulo está activo. La dirección corta del módulo se conserva.',
    bullets: ['El nombre en singular ayuda a identificar cada registro.', 'Presiona Guardar cambios para aplicar tus ajustes.']
  },
  'module-edit:fields': {
    tourId: MODULE_EDIT_TOURS.fields,
    title: 'Campos', requires: ['settings.modules'],
    summary: 'Los campos son los datos que guardará cada registro, como una fecha, un importe o una lista de opciones. Aquí puedes agregarlos, editarlos y ordenar cómo aparecen.',
    bullets: ['Elige el tipo de dato y si es obligatorio.', 'La vista previa muestra cómo queda el módulo.']
  },
  'module-edit:relations': {
    tourId: MODULE_EDIT_TOURS.relations,
    title: 'Relaciones', requires: ['settings.modules'],
    summary: 'Aquí defines los tipos de vínculo de este módulo con otros módulos. Puedes dar nombre a una relación, elegir el módulo relacionado y revisar los vínculos existentes.',
    bullets: ['Esta pantalla configura tipos de vínculo; los registros se vinculan en su ficha.']
  },
  'module-edit:menu': {
    tourId: MODULE_EDIT_TOURS.menu,
    title: 'Ubicación en menú', requires: ['settings.modules'],
    summary: 'Agrupa el módulo en el menú para que sea más fácil encontrarlo. Puedes elegir un grupo existente o crear uno con su nombre e icono.',
    bullets: ['Los catálogos se consultan desde los selectores y no aparecen en el menú operativo.']
  },
  'module-edit:detail': {
    tourId: MODULE_EDIT_TOURS.detail,
    title: 'Diseño del detalle', requires: ['settings.modules'],
    summary: 'Decide qué información aparece en la ficha de un registro. Puedes mostrar u ocultar propiedades y relaciones, y arrastrarlas para cambiar su orden.',
    bullets: ['También puedes mostrar la actividad del registro.', 'Revisa la vista previa y presiona Guardar diseño.']
  },
  'module-edit:list': {
    tourId: MODULE_EDIT_TOURS.list,
    title: 'Diseño del listado', requires: ['settings.modules'],
    summary: 'Elige las columnas, los filtros y el orden inicial de la lista de registros. También puedes configurar las vistas de tablero y calendario con los campos del módulo.',
    bullets: ['La vista previa permite revisar cada diseño.', 'Presiona Guardar diseño para aplicar los cambios.']
  },
  'module-edit:flow': {
    tourId: MODULE_EDIT_TOURS.flow,
    title: 'Flujo de estados', requires: ['settings.modules'],
    summary: 'Usa las opciones de un campo Select como estados y elige el estado inicial de los registros. Define qué cambios de estado se permiten y qué roles pueden realizarlos.',
    bullets: ['Activa el flujo y selecciona el campo Select y el estado inicial.', 'Agrega transiciones con origen, destino y rol.', 'Arrastra los estados del mapa para acomodarlos o usa el asa + para conectarlos.', 'El bloqueo por estado controla si el registro se puede modificar; guarda el flujo para aplicar las reglas.']
  },
  'module-edit:labels': {
    tourId: MODULE_EDIT_TOURS.labels,
    title: 'Etiquetas', requires: ['settings.modules'],
    summary: 'Activa la impresión y prepara una etiqueta con los datos de tus registros. Elige el tamaño, las copias y los campos que aparecerán como título, texto y código de barras.',
    bullets: ['Revisa la vista previa antes de guardar la etiqueta.', 'Puedes incluir otros campos y el logo cuando esté disponible.']
  },
  'module-edit:api': {
    tourId: MODULE_EDIT_TOURS.api,
    title: 'API', requires: ['settings.modules'],
    summary: 'Esta pantalla muestra cómo conectar otras herramientas con los registros del módulo. Reúne ejemplos de solicitudes, campos disponibles y los permisos de tu usuario.',
    bullets: ['Puedes copiar un ejemplo para compartirlo con quien prepare la integración.', 'Los ejemplos requieren sustituir la clave de acceso y el identificador del registro.']
  }
}

export function chattitoHelpId(context: ChattitoContext): ChattitoHelpId | null {
  return context.page === 'module-edit' ? `module-edit:${context.tab}` : null
}

export function helpForContext(context: ChattitoContext): ChattitoHelp | null {
  const id = chattitoHelpId(context)
  return id ? chattitoHelpCatalog[id] : null
}

export function canReadChattitoHelp(help: ChattitoHelp, access: TourAccess) {
  return help.requires.every(requirement => meetsTourRequirement(requirement, access))
}

export function chattitoHelpStorageKey(tenantId: string, userId: string, id: ChattitoHelpId, kind: 'seen' | 'dismissed') {
  return `flow-chattito-help:${tenantId}:${userId}:${id}:${kind}`
}

export function chattitoHelpPreferenceKey(tenantId: string, userId: string) {
  return `flow-chattito-help:${tenantId}:${userId}:disabled`
}

export interface ChattitoHelpVisibility {
  eligible: boolean
  permitted: boolean
  disabled: boolean
  dismissed: boolean
  seen: boolean
  activeTour: boolean
  conversationOpen: boolean
}

export function shouldShowChattitoHelp(state: ChattitoHelpVisibility) {
  return state.eligible && state.permitted && !state.disabled && !state.dismissed && !state.seen && !state.activeTour && !state.conversationOpen
}

export function chattitoHelpMessage(help: ChattitoHelp) {
  return [help.title, help.summary, ...(help.bullets ?? []).map(bullet => `• ${bullet}`)].join('\n\n')
}
