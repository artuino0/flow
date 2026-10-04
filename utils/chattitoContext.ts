import { MODULE_EDIT_TABS, normalizeModuleEditTab, type ModuleEditTab } from './moduleEditTabs'
import { chattitoHelpCatalog, helpForContext } from './chattitoHelp'
import type { TourId } from './onboardingTours'

export const SETTINGS_SECTIONS = ['organizacion', 'perfil', 'seguridad', 'plan', 'identidad', 'regional', 'facturacion', 'integraciones', 'grupos'] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]

export type ChattitoContext =
  | { page: 'sites-agenda'; siteId: string }
  | { page: 'module-edit'; tab: ModuleEditTab; moduleId: string }
  | { page: 'settings'; section: SettingsSection }
  | { page: 'unknown' }

export interface ChattitoRoute {
  path: string
  params: Record<string, unknown>
  query: Record<string, unknown>
}

// Cada pantalla puede sumar su propio resolvedor sin acoplarse a Vue/Nuxt.
const contextResolvers: ((route: ChattitoRoute) => ChattitoContext | null)[] = [
  route => {
    const match = /^\/modulos\/([^/]+)\/editar\/?$/.exec(route.path)
    if (!match) return null
    const moduleId = typeof route.params.id === 'string' ? route.params.id : match[1]!
    return { page: 'module-edit', moduleId, tab: normalizeModuleEditTab(route.query.tab) }
  }
]

export function resolveChattitoContext(route: ChattitoRoute, isAdmin = false): ChattitoContext {
  const agenda = /^\/sites\/([^/]+)\/agenda\/?$/.exec(route.path)
  if (agenda) return { page: 'sites-agenda', siteId: agenda[1]! }
  if (/^\/ajustes\/?$/.test(route.path)) {
    const section = route.query.section === undefined || route.query.section === null || route.query.section === ''
      ? isAdmin ? 'organizacion' : 'perfil' : route.query.section
    return typeof section === 'string' && SETTINGS_SECTIONS.some(value => value === section)
      ? { page: 'settings', section: section as SettingsSection } : { page: 'unknown' }
  }
  for (const resolve of contextResolvers) {
    const context = resolve(route)
    if (context) return context
  }
  return { page: 'unknown' }
}

// Los recorridos actuales crean módulos en /modulos/nuevo; no enseñan a editar
// el módulo abierto. Agregar una recomendación futura requiere una sola entrada.
export const MODULE_EDIT_TOUR_RECOMMENDATIONS = Object.fromEntries(
  Object.values(MODULE_EDIT_TABS).map(tab => [tab, chattitoHelpCatalog[`module-edit:${tab}`].tourId ?? null])
) as Readonly<Record<ModuleEditTab, TourId | null>>

export function recommendedTourForContext(context: ChattitoContext): TourId | null {
  return helpForContext(context)?.tourId ?? null
}
