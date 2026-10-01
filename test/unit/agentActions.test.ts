import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, watch } from 'vue'
import { runAgentAction, AGENT_TOUR_FAILURE, type AgentActionDependencies } from '../../utils/agentActions'
import { TOUR_SELECTORS, waitForTourTarget } from '../../utils/onboardingTours'

describe('acciones del agente tras navegación, sin navegador ni red', () => {
 let deps: AgentActionDependencies
 let route: { path: string; fullPath: string; query: Record<string, unknown> }
 let routerPath: string
 let target: Element | null
 let current: boolean
 let events: string[]
 const element = { getClientRects: () => [{}] } as unknown as Element
 beforeEach(() => {
  vi.useFakeTimers()
  route = reactive({ path: '/', fullPath: '/', query: {} })
  routerPath = '/'
  target = element
  current = true
  events = []
  deps = {
   route: () => route,
   routerPath: () => routerPath,
   push: vi.fn(async path => {
    events.push('push')
    routerPath = path
    setTimeout(() => {
     const url = new URL(path, 'https://local.test')
     route.path = url.pathname; route.fullPath = path
     route.query = Object.fromEntries(url.searchParams)
    }, 100)
    return true
   }),
   nextTick: async () => { events.push('tick'); await nextTick() },
   isCurrent: () => current,
   prepareTour: vi.fn(async () => { events.push('permissions'); return true }),
   firstSelector: () => TOUR_SELECTORS.settingsPlanRefresh,
   waitTarget: vi.fn((selector, ready, abort, timeoutMs) => waitForTourTarget(() => ready() ? selector ? target : element : null, () => true, { timeoutMs, intervalMs: 50, abort })),
   startTour: vi.fn(async () => { events.push('start'); return true }),
   point: vi.fn(async () => { events.push('point') }),
   message: vi.fn(),
   beforeTour: vi.fn(() => { events.push('close') })
  }
 })
 afterEach(() => vi.useRealTimers())

 it('procesa el observador de ruta, permisos pendientes y elemento antes de iniciar', async () => {
  target = null
  const stop = watch(() => route.fullPath, () => events.push('watch'))
  deps.prepareTour = vi.fn(() => new Promise<boolean>(resolve => setTimeout(() => { events.push('permissions'); resolve(true) }, 200)))
  setTimeout(() => { target = element }, 500)
  try {
   const result = runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, deps)
   await vi.advanceTimersByTimeAsync(450)
   expect(deps.startTour).not.toHaveBeenCalled()
   await vi.advanceTimersByTimeAsync(100)
   expect(await result).toBe(true)
   expect(events).toEqual(['push', 'watch', 'tick', 'permissions', 'tick', 'close', 'tick', 'start'])
   expect(deps.waitTarget).toHaveBeenLastCalledWith(TOUR_SELECTORS.settingsPlanRefresh, expect.any(Function), expect.any(Function), expect.any(Number))
  } finally { stop() }
 })

 it.each(['point', 'navigate'] as const)('%s espera la ruta y el elemento que se renderiza después', async kind => {
  target = null
  setTimeout(() => { target = element }, 600)
  const result = runAgentAction(kind === 'point' ? { kind, anchor: 'settingsPlanLimits' } : { kind, path: '/ajustes?section=plan' }, deps)
  await vi.advanceTimersByTimeAsync(500)
  expect(deps.point).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(150)
  expect(await result).toBe(true)
  expect(deps.waitTarget).toHaveBeenLastCalledWith(kind === 'point' ? TOUR_SELECTORS.settingsPlanLimits : 'main', expect.any(Function), expect.any(Function), expect.any(Number))
  if (kind === 'point') expect(deps.point).toHaveBeenCalledWith(element, 'Plan y consumo', expect.any(String))
  expect(deps.startTour).not.toHaveBeenCalled()
 })

 it.each(['ruta', 'permisos', 'elemento', 'inicio'] as const)('el fallo de %s es visible y la espera tiene un tope de 8 segundos', async reason => {
  if (reason === 'ruta') deps.push = vi.fn(async path => { routerPath = path; return true })
  if (reason === 'permisos') deps.prepareTour = vi.fn(() => new Promise<boolean>(() => {}))
  if (reason === 'elemento') target = null
  if (reason === 'inicio') deps.startTour = vi.fn(async () => false)
  const result = runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, deps)
  await vi.advanceTimersByTimeAsync(8_000)
  expect(await result).toBe(false)
  expect(deps.message).toHaveBeenCalledExactlyOnceWith(AGENT_TOUR_FAILURE)
  if (reason !== 'inicio') expect(deps.startTour).not.toHaveBeenCalled()
 })

 it.each(['point', 'navigate'] as const)('%s comunica un elemento ausente', async kind => {
  target = null
  const result = runAgentAction(kind === 'point' ? { kind, anchor: 'settingsPlanLimits' } : { kind, path: '/ajustes?section=plan' }, deps)
  await vi.advanceTimersByTimeAsync(8_000)
  expect(await result).toBe(false)
  expect(deps.message).toHaveBeenCalledOnce()
  expect(deps.point).not.toHaveBeenCalled()
 })

 it.each(['otra-pantalla', 'sesión'] as const)('aborta una espera si cambia %s', async change => {
  target = null
  const result = runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, deps)
  await vi.advanceTimersByTimeAsync(200)
  if (change === 'sesión') current = false
  else routerPath = '/roles'
  target = element
  await vi.advanceTimersByTimeAsync(50)
  expect(await result).toBe(false)
  expect(deps.startTour).not.toHaveBeenCalled()
  if (change === 'sesión') expect(deps.message).not.toHaveBeenCalled()
  else expect(deps.message).toHaveBeenCalledWith(AGENT_TOUR_FAILURE)
 })

 it('una navegación cancelada muestra mensaje y no inicia ayuda en la pantalla anterior', async () => {
  deps.push = vi.fn(async () => false)
  expect(await runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, deps)).toBe(false)
  expect(deps.message).toHaveBeenCalledWith(AGENT_TOUR_FAILURE)
  expect(deps.prepareTour).not.toHaveBeenCalled()
 })

 it('una redirección a otra pantalla no se confunde con haber abierto el destino', async () => {
  deps.push = vi.fn(async () => { routerPath = '/login'; return true })
  expect(await runAgentAction({ kind: 'navigate', path: '/ajustes?section=plan' }, deps)).toBe(false)
  expect(deps.message).toHaveBeenCalledOnce()
  expect(deps.point).not.toHaveBeenCalled()
 })

 it('captura errores y rechaza IDs desconocidos sin estados colgados', async () => {
  deps.push = vi.fn(async () => { throw new Error('navegación') })
  expect(await runAgentAction({ kind: 'start-tour', tourId: 'ajustes-plan' }, deps)).toBe(false)
  expect(await runAgentAction({ kind: 'start-tour', tourId: 'inventado' }, deps)).toBe(false)
  expect(deps.message).toHaveBeenCalledTimes(2)
  expect(deps.startTour).not.toHaveBeenCalled()
 })
})
