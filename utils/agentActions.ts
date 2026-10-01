import type { AgentAction } from './agentConversation'
import { chattitoCatalog, agentAnchorScreen, AGENT_EDIT_PATH } from './chattitoCatalog'
import { AGENT_MODULE_PATH } from './agentRouteSlug'
import { contextualTourMatchesRoute, isModuleEditTour, onboardingTours, TOUR_SELECTORS, type TourId } from './onboardingTours'

export const AGENT_TOUR_FAILURE = 'No pude iniciar el recorrido aquí. Abre esa pantalla y pídemelo de nuevo; aquí sigo para acompañarte.'
export const AGENT_MODULE_TOUR_HELP = 'Abre un módulo y pídemelo desde su edición, en la pestaña que quieres recorrer. Te acompaño desde ahí.'
/** El último registro debe ser la página concreta, nunca un catch-all ni solo su padre. */
export function agentModuleRouteExists(path: string, resolve: (path: string) => { matched: readonly { path: string }[] }) {
 const edit = AGENT_EDIT_PATH.exec(path)
 if (edit) return resolve(path).matched.at(-1)?.path.replace(':id()', ':id') === '/modulos/:id/editar'
 const match = AGENT_MODULE_PATH.exec(path)
 if (!match) return false
 const expected = `/registros/:entity${match[2] || ''}`
 return resolve(path).matched.at(-1)?.path.replace(':entity()', ':entity') === expected
}
interface ActionRoute { path: string; fullPath: string; query: Record<string, unknown> }
export interface AgentActionDependencies {
 route: () => ActionRoute
 routerPath: () => string
 push: (path: string) => Promise<boolean>
 routeExists?: (path: string) => boolean
 prepareEdit?: (id: string) => Promise<boolean>
 prepareModule?: (slug: string, create: boolean) => Promise<boolean>
 nextTick: () => Promise<void>
 isCurrent: () => boolean
 prepareTour: (id: TourId) => Promise<boolean>
 firstSelector: (id: TourId) => string | undefined
 waitTarget: (selector: string | undefined, ready: () => boolean, abort: () => boolean, timeoutMs: number) => Promise<Element | null>
 startTour: (id: TourId) => Promise<boolean>
 point: (element: Element, title: string, summary: string) => Promise<void>
 message: (text: string, actions?: AgentAction[]) => void
 beforeTour: () => void
}

/** Espera la ruta de Nuxt (que puede ir detrás del router) y su flush antes de actuar. */
export async function runAgentAction(action: AgentAction, deps: AgentActionDependencies): Promise<boolean> {
 const deadline = Date.now() + 8_000
 const remaining = () => Math.max(0, deadline - Date.now())
 const fail = (text: string, actions?: AgentAction[]) => {
  if (!deps.isCurrent()) return false
  if (action.kind === 'point' && text === failure) {
   const screen = agentAnchorScreen(action.anchor)
   const path = action.path && AGENT_EDIT_PATH.test(action.path) ? action.path : screen?.path
   if (screen && path) { text = `No pude abrir ${screen.name} para señalar ese elemento ahora. Te acompaño a esa pantalla cuando quieras volver a intentarlo.`; actions = [{ kind: 'navigate', path, label: 'Llévame', ...(action.moduleId ? { moduleId: action.moduleId } : {}) }] }
  }
  if (actions) deps.message(text, actions); else deps.message(text)
  return false
 }
 const failure = action.kind === 'start-tour' ? AGENT_TOUR_FAILURE : 'No pude abrir esa ayuda ahora. Puedes intentarlo otra vez; aquí sigo contigo.'
 try {
  const screen = action.kind === 'point' ? agentAnchorScreen(action.anchor) : chattitoCatalog.find(screen => action.kind === 'navigate' ? screen.path === action.path : screen.tourId === action.tourId)
  const id = action.kind === 'start-tour' && Object.hasOwn(onboardingTours, action.tourId) ? action.tourId as TourId : null
  if (action.kind === 'start-tour' && !id) return fail(failure)
  if (id && isModuleEditTour(id) && !action.path && !contextualTourMatchesRoute(id, deps.route().path, deps.route().query)) return fail(AGENT_MODULE_TOUR_HELP)
  if (action.kind === 'point' && screen?.id.startsWith('module-edit:') && !action.path && !contextualTourMatchesRoute(screen.tourId!, deps.route().path, deps.route().query)) return fail(`Ese elemento está en ${screen.name}, en la edición del módulo. Elige un módulo y te acompaño.`, [{ kind: 'navigate', path: '/modulos', label: 'Llévame' }])
  const resolvedPath = action.path
  const edit = resolvedPath && AGENT_EDIT_PATH.exec(resolvedPath)
  if (resolvedPath && action.kind !== 'navigate' && !edit && resolvedPath !== screen?.path) return fail(failure)
  if (edit && (!screen && action.kind !== 'navigate' || screen?.id.startsWith('module-edit:') && screen.id !== `module-edit:${edit[2]}` || action.moduleId && action.moduleId !== edit[1])) return fail(failure)
  if (edit) {
   if (!deps.routeExists?.(resolvedPath!)) return fail(failure)
   const origin = deps.routerPath()
   let timer: ReturnType<typeof setTimeout> | undefined
   const permitted = await Promise.race([deps.prepareEdit?.(edit[1]!) ?? Promise.resolve(false), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), remaining()) })]).finally(() => { if (timer) clearTimeout(timer) })
   if (!permitted || !deps.isCurrent() || deps.routerPath() !== origin) return fail('Esa configuración la ve un administrador. Pídele que te acompañe; aquí sigo contigo.')
  }
  const dynamicPath = action.kind === 'navigate' && AGENT_MODULE_PATH.test(action.path) ? action.path : undefined
  if (dynamicPath && !deps.routeExists?.(dynamicPath)) return fail('No encuentro esa pantalla ahora. Pídeme de nuevo el módulo y te ayudo a abrirlo.')
  if (action.kind === 'navigate' && !screen?.path && !dynamicPath && !edit) return fail(failure)
  if (dynamicPath) {
   const match = AGENT_MODULE_PATH.exec(dynamicPath)!
   const origin = deps.routerPath()
   let timer: ReturnType<typeof setTimeout> | undefined
   const permitted = await Promise.race([
    deps.prepareModule?.(match[1]!, Boolean(match[2])) ?? Promise.resolve(false),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), remaining()) })
   ]).finally(() => { if (timer) clearTimeout(timer) })
   if (!permitted || !deps.isCurrent() || deps.routerPath() !== origin) return fail('No pude abrir ese módulo con tus permisos actuales. Pídemelo de nuevo y revisamos juntos dónde continuar.')
  }
  // El recorrido manual comienza en Ajustes, antes de abrir el asistente de creación.
  const destination = id === 'crear-modulo-manual' ? onboardingTours[id].steps[0]?.path : (edit ? resolvedPath : undefined) || dynamicPath || screen?.path
  if (destination && deps.routerPath() !== destination && !await deps.push(destination)) return fail(failure)
  if (destination && deps.routerPath() !== destination) return fail(failure)
  const expectedPath = deps.routerPath()
  const abort = () => !deps.isCurrent() || deps.routerPath() !== expectedPath
  const ready = () => deps.route().fullPath === expectedPath
  if (!await deps.waitTarget(undefined, ready, abort, remaining())) return fail(failure)
  await deps.nextTick()
  if (abort() || !ready()) return fail(failure)
  if (id && isModuleEditTour(id) && !contextualTourMatchesRoute(id, deps.route().path, deps.route().query)) return fail(AGENT_MODULE_TOUR_HELP)
  if (id) {
   // La preparación no activa ningún recorrido; si vence el plazo no deja activeId huérfano.
   let timer: ReturnType<typeof setTimeout> | undefined
   const permitted = await Promise.race([
    deps.prepareTour(id),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), remaining()) })
   ]).finally(() => { if (timer) clearTimeout(timer) })
   if (!permitted || abort() || !ready()) return fail(failure)
   if (!await deps.waitTarget(deps.firstSelector(id), ready, abort, remaining())) return fail(failure)
   await deps.nextTick()
   if (abort() || !ready()) return fail(failure)
   deps.beforeTour()
   await deps.nextTick()
   if (abort() || !ready()) return fail(failure)
   if (!await deps.startTour(id)) return fail(failure)
   return true
  }
  const selector = action.kind === 'point' ? TOUR_SELECTORS[action.anchor as keyof typeof TOUR_SELECTORS] : 'main'
  if (!selector) return fail(failure)
  const element = await deps.waitTarget(selector, ready, abort, remaining())
  if (!element || abort() || !ready()) {
   if (action.kind === 'point' && !abort()) {
    const path = destination || (screen?.id.startsWith('module-edit:') ? deps.route().fullPath : undefined)
    return fail(`No pude señalar el elemento de ${screen?.name || 'esa pantalla'} ahora. Te acompaño a esa pantalla para revisarlo.`, path ? [{ kind: 'navigate', path, label: 'Llévame', ...(action.moduleId ? { moduleId: action.moduleId } : {}) }] : undefined)
   }
   return fail(failure)
  }
  await deps.nextTick()
  if (abort() || !ready()) return fail(failure)
  if (action.kind === 'point') await deps.point(element, screen?.name || 'Aquí', screen?.summary || 'Este es el elemento que buscas.')
  return true
 } catch { return fail(failure) }
}
