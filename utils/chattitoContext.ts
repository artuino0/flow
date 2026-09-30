import { normalizeModuleEditTab, type ModuleEditTab } from './moduleEditTabs'
import type { TourId } from './onboardingTours'

export type ChattitoContext =
  | { page: 'module-edit'; tab: ModuleEditTab; moduleId: string }
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

export function resolveChattitoContext(route: ChattitoRoute): ChattitoContext {
  for (const resolve of contextResolvers) {
    const context = resolve(route)
    if (context) return context
  }
  return { page: 'unknown' }
}

// Los recorridos actuales crean módulos en /modulos/nuevo; no enseñan a editar
// el módulo abierto. Agregar una recomendación futura requiere una sola entrada.
export const MODULE_EDIT_TOUR_RECOMMENDATIONS: Readonly<Record<ModuleEditTab, TourId | null>> = {
  info: null,
  fields: null,
  relations: null,
  menu: null,
  detail: null,
  list: null,
  flow: null,
  labels: null,
  api: null
}

export function recommendedTourForContext(context: ChattitoContext): TourId | null {
  return context.page === 'module-edit' ? MODULE_EDIT_TOUR_RECOMMENDATIONS[context.tab] : null
}
