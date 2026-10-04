import { chattitoHelpCatalog } from './chattitoHelp'
import { canRunTour, meetsTourRequirement, onboardingTours, TOUR_SELECTORS, type TourAccess, type TourId } from './onboardingTours'
import type { AgentReplyContext, AgentAction } from './agentConversation'
import { matchTenantModules, type AgentTenantModule } from './agentTenantCatalog'
import { AGENT_MODULE_PATH } from './agentRouteSlug'
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
 ...Object.entries(chattitoHelpCatalog).map(([id, help]): AgentScreen => ({ id, name: help.title, path: id === 'settings:plan' ? '/ajustes?section=plan' : undefined, synonyms: [help.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), ...(id.startsWith('module-edit:') ? [({ info: 'informacion general', fields: 'campos', relations: 'relaciones', menu: 'menu del modulo', detail: 'detalle', list: 'listado', flow: 'flujo', labels: 'etiquetas', api: 'api del modulo' } as Record<string,string>)[id.split(':')[1]!]!] : id === 'settings:plan' ? ['plan', 'consumo', 'limites'] : [])], admin: true, anchor: id === 'settings:plan' ? 'settingsPlanLimits' : id === 'sites:agenda' ? 'sitesAgendaSettings' : ({ info: 'editTabInfo', fields: 'editTabFields', relations: 'editTabRelations', menu: 'editTabMenu', detail: 'editTabDetail', list: 'editTabList', flow: 'editTabFlow', labels: 'editTabLabels', api: 'editTabApi' } as const)[id.split(':')[1] as 'info'], tourId: help.tourId, summary: help.summary }))
]
export function permittedAgentCatalog(access: TourAccess) { return chattitoCatalog.filter(screen => (!screen.admin || access.isAdmin) && (!screen.designer || access.designerAvailable)) }
export function screenActions(screen: AgentScreen): AgentAction[] { return [...(screen.path ? [{ kind: 'navigate' as const, path: screen.path }] : []), ...(screen.anchor ? [{ kind: 'point' as const, anchor: screen.anchor }] : []), ...(screen.tourId ? [{ kind: 'start-tour' as const, tourId: screen.tourId }] : [])] }
/** Catálogo de anclas existentes: incluye los elementos internos de cada recorrido. */
export function agentAnchorScreen(anchor: string) {
 const selector = TOUR_SELECTORS[anchor as keyof typeof TOUR_SELECTORS]
 if (!selector) return undefined
 return chattitoCatalog.find(screen => screen.anchor === anchor) || chattitoCatalog.find(screen => screen.tourId && onboardingTours[screen.tourId].steps.some(step => step.selector === selector))
}
export const AGENT_EDIT_PATH = /^\/modulos\/([a-zA-Z0-9_-]{1,100})\/editar\?tab=(info|fields|relations|menu|detail|list|flow|labels|api)$/
export function validateAgentActions(actions: AgentAction[], access: TourAccess, modules: readonly AgentTenantModule[] = [], reference: AgentReplyContext = {}) {
 const catalog = permittedAgentCatalog(access)
 const current = reference.context
 const currentModule = /^\/modulos\/([^/]+)\/editar\/?$/.exec(current?.path || '')
 const recentActions = [...(reference.history || [])].reverse().find(turn => turn.role === 'assistant')?.actions
 const summary = (recentActions?.find(action => action.kind === 'navigate') || recentActions?.[0])?.label
 const message = /\b(eso|ah[ií]|all[aá])\b/i.test(reference.message || '') && summary ? summary : reference.message || ''
 const named = matchTenantModules(message.replace(/\b(m[oó]dulos?|cat[aá]logos?)\b/gi, ''), modules)
 const target = named.length === 1 ? named[0] : !named.length ? modules.find(module => module.id === currentModule?.[1]) : undefined
 const result = actions.flatMap((action): AgentAction[] => {
  const explicit = action.path
  const edit = explicit && AGENT_EDIT_PATH.exec(explicit)
  if (edit && (!access.isAdmin || !modules.some(module => module.id === edit[1]) || (action.moduleId && action.moduleId !== edit[1]))) return []
  if (action.moduleId && !modules.some(module => module.id === action.moduleId)) return []
  if (action.kind === 'navigate') {
   if (edit) {
    const module = modules.find(module => module.id === edit[1])!
    const screen = catalog.find(screen => screen.id === `module-edit:${edit[2]}`)!
    return [{ kind: 'navigate', path: action.path, moduleId: module.id, label: `Llévame a ${screen.name} de ${module.name}`.slice(0, 65) }]
   }
   const match = AGENT_MODULE_PATH.exec(action.path)
   const module = match && modules.find(module => module.slug === match[1])
   if (module && (!match[2] || module.canCreate)) return [{ kind: 'navigate', path: action.path, label: match[2] ? 'Nuevo registro' : `Llévame a ${module.name}`.slice(0, 65) }]
   return catalog.some(screen => screen.path === action.path) ? [action] : []
  }
  const screen = action.kind === 'point' ? agentAnchorScreen(action.anchor) : catalog.find(screen => screen.tourId === action.tourId)
  if (!screen || !catalog.includes(screen)) return []
  if (action.kind === 'point' && screen.tourId) {
   const selector = TOUR_SELECTORS[action.anchor as keyof typeof TOUR_SELECTORS]
   const step = onboardingTours[screen.tourId].steps.find(step => step.selector === selector)
   if (step?.requires && !meetsTourRequirement(step.requires, access)) return []
  }
  if (action.kind === 'start-tour' && !canRunTour(onboardingTours[action.tourId as TourId], access)) return []
  if (screen.id.startsWith('module-edit:')) {
   const tab = screen.id.split(':')[1]!
   if (edit && edit[2] !== tab) return []
   const module = edit ? modules.find(module => module.id === edit[1]) : action.moduleId ? modules.find(module => module.id === action.moduleId) : target
   if (named.length === 1 && module && named[0]!.id !== module.id) return []
   const here = current?.page === 'module-edit' && current.tab === tab && currentModule && (!module || currentModule[1] === module.id)
   const path = module ? `/modulos/${module.id}/editar?tab=${tab}` : undefined
   if (action.kind === 'point') {
    if (here) return [{ ...action, ...(path ? { path, moduleId: module!.id } : {}), label: `Señálame ${screen.name}${module ? ` de ${module.name}` : ''}`.slice(0, 65) }, ...(actions.some(item => item.kind === 'start-tour' && item.tourId === screen.tourId) ? [] : [{ kind: 'start-tour' as const, tourId: screen.tourId!, ...(path ? { path, moduleId: module!.id } : {}) }])]
    if (!path) return []
    return [...(actions.some(item => item.kind === 'navigate' && item.path === path) ? [] : [{ kind: 'navigate' as const, path, moduleId: module!.id, label: `Llévame a ${screen.name} de ${module!.name}`.slice(0, 65) }]), ...(actions.some(item => item.kind === 'start-tour' && item.tourId === screen.tourId) ? [] : [{ kind: 'start-tour' as const, tourId: screen.tourId!, path, moduleId: module!.id }])]
   }
   return path ? [{ ...action, path, moduleId: module!.id }] : here ? [action] : []
  }
  if (explicit && explicit !== screen.path) return []
  if (action.kind === 'point') {
   if (!screen.path) return []
   const url = new URL(screen.path, 'https://local.test')
   const here = current?.path === url.pathname && (!url.searchParams.has('section') || current.section === url.searchParams.get('section'))
   return here ? [{ ...action, path: screen.path, label: `Señálame ${screen.name}` }] : actions.some(item => item.kind === 'navigate' && item.path === screen.path) ? [] : [{ kind: 'navigate', path: screen.path, label: `Llévame a ${screen.name}` }]
  }
  return [action]
 })
 return result.slice(0, 3)
}
