import { chattitoHelpCatalog } from './chattitoHelp'
import { canRunTour, onboardingTours, TOUR_SELECTORS, type TourAccess, type TourId } from './onboardingTours'
import type { AgentAction } from './agentConversation'
import { AGENT_MODULE_PATH, type AgentTenantModule } from './agentTenantCatalog'
export interface AgentScreen { id: string; name: string; path?: string; synonyms: string[]; admin?: boolean; designer?: boolean; anchor?: keyof typeof TOUR_SELECTORS; tourId?: TourId; summary: string }
export const chattitoCatalog: AgentScreen[] = [
 { id: 'home', name: 'Inicio', path: '/', synonyms: ['inicio', 'tablero', 'bienvenida'], anchor: 'dashboard', tourId: 'bienvenida', summary: 'En Inicio encuentras tu tablero de trabajo.' },
 { id: 'modules', name: 'Módulos', path: '/modulos', synonyms: ['modulos', 'editar modulo'], admin: true, anchor: 'modulesCore', summary: 'Aquí administras tus módulos operativos y abres su edición. En la edición encontrarás las pestañas de configuración. Los catálogos de referencia se administran por separado.' },
 { id: 'catalogs', name: 'Catálogos', path: '/catalogos', synonyms: ['catalogos', 'catalogo', 'tablas de referencia', 'listas de referencia', 'dimensiones'], admin: true, summary: 'Los catálogos son datos de referencia, como servicios o productos, que usas en selectores; no aparecen en el menú principal.' },
 { id: 'create-catalog', name: 'Crear catálogo', path: '/catalogos/nuevo', synonyms: ['crear catalogo'], admin: true, summary: 'El asistente te acompaña para definir un catálogo de referencia que usarás desde los selectores.' },
 { id: 'create', name: 'Crear módulo', path: '/modulos/nuevo', synonyms: ['crear modulo', 'modulo manual'], admin: true, anchor: 'manualCreate', tourId: 'crear-modulo-manual', summary: 'El asistente te guía para definir un módulo manualmente.' },
 { id: 'designer', name: 'Diseñador', path: '/disenador', synonyms: ['disenador', 'disenar modulo'], admin: true, designer: true, anchor: 'designerPrompt', tourId: 'primer-modulo', summary: 'Describe tu negocio en el Diseñador para preparar una propuesta. Revisas y apruebas sus cambios allí.' },
 ...[{ id: 'roles', name: 'Roles', path: '/roles', synonyms: ['roles', 'permisos'] }, { id: 'users', name: 'Usuarios', path: '/usuarios', synonyms: ['usuarios', 'invitar'] }, { id: 'organization', name: 'Organización', path: '/ajustes?section=organizacion', synonyms: ['organizacion'] }, { id: 'billing', name: 'Facturación', path: '/facturacion', synonyms: ['facturacion', 'facturas'] }, { id: 'sites', name: 'Sites', path: '/sites', synonyms: ['sites', 'sitios'] }, { id: 'triggers', name: 'Triggers', path: '/triggers', synonyms: ['triggers', 'automatizaciones'] }, { id: 'reports', name: 'Reportes', path: '/reportes/nuevo', synonyms: ['reportes', 'informes'] }].map(screen => ({ ...screen, admin: true, summary: `Abre ${screen.name} para revisar su configuración en Flow.` })),
 { id: 'chat', name: 'Chat', path: '/chat', synonyms: ['chat', 'conversaciones'], summary: 'El chat conecta las conversaciones de tu equipo.' },
 { id: 'settings', name: 'Ajustes', path: '/ajustes?section=perfil', synonyms: ['ajustes', 'perfil'], summary: 'En Ajustes puedes revisar tu perfil y las secciones disponibles para tu cuenta.' },
 ...['seguridad', 'integraciones', 'identidad', 'regional', 'grupos', 'facturacion'].map(section => ({ id: `settings-${section}`, name: section, path: `/ajustes?section=${section}`, synonyms: [section], admin: section !== 'seguridad', summary: `Consulta ${section} en Ajustes.` })),
 ...Object.entries(chattitoHelpCatalog).map(([id, help]): AgentScreen => ({ id, name: help.title, path: id === 'settings:plan' ? '/ajustes?section=plan' : undefined, synonyms: [help.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), ...(id.startsWith('module-edit:') ? [({ info: 'informacion general', fields: 'campos', relations: 'relaciones', menu: 'menu del modulo', detail: 'detalle', list: 'listado', flow: 'flujo', labels: 'etiquetas', api: 'api del modulo' } as Record<string,string>)[id.split(':')[1]!]!] : ['plan', 'consumo', 'limites'])], admin: true, anchor: id === 'settings:plan' ? 'settingsPlanLimits' : ({ info: 'editTabInfo', fields: 'editTabFields', relations: 'editTabRelations', menu: 'editTabMenu', detail: 'editTabDetail', list: 'editTabList', flow: 'editTabFlow', labels: 'editTabLabels', api: 'editTabApi' } as const)[id.split(':')[1] as 'info'], tourId: help.tourId, summary: help.summary }))
]
export function permittedAgentCatalog(access: TourAccess) { return chattitoCatalog.filter(screen => (!screen.admin || access.isAdmin) && (!screen.designer || access.designerAvailable)) }
export function screenActions(screen: AgentScreen): AgentAction[] { return [...(screen.path ? [{ kind: 'navigate' as const, path: screen.path }] : []), ...(screen.anchor ? [{ kind: 'point' as const, anchor: screen.anchor }] : []), ...(screen.tourId ? [{ kind: 'start-tour' as const, tourId: screen.tourId }] : [])] }
export function validateAgentActions(actions: AgentAction[], access: TourAccess, modules: readonly AgentTenantModule[] = []) {
 const catalog = permittedAgentCatalog(access)
 return actions.flatMap((action): AgentAction[] => {
  if (action.kind === 'navigate') {
   const match = AGENT_MODULE_PATH.exec(action.path)
   const module = match && modules.find(module => module.slug === match[1])
   if (module && (!match[2] || module.canCreate)) return [{ kind: 'navigate', path: action.path, label: match[2] ? 'Nuevo registro' : `Llévame a ${module.name}`.slice(0, 65) }]
  }
  return catalog.some(screen => action.kind === 'navigate' ? screen.path === action.path : action.kind === 'point' ? screen.anchor === action.anchor : screen.tourId === action.tourId && canRunTour(onboardingTours[screen.tourId], access)) ? [action] : []
 }).slice(0, 3)
}
