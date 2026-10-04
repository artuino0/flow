import { AsyncLocalStorage } from 'node:async_hooks'
import { useEvent } from 'nitropack/runtime/context'
import { performance } from 'node:perf_hooks'
import type { H3Event } from 'h3'
import type postgres from 'postgres'

export interface RequestPerformance { start: number; queries: number; trips: number; databaseMs: number }
const local = new AsyncLocalStorage<RequestPerformance>()
export function performanceEnabled(env: NodeJS.ProcessEnv = process.env) { return env.NODE_ENV === 'development' || env.REQUEST_PERFORMANCE_ENABLED === 'true' }
export function performanceScope<T>(metrics: RequestPerformance, fn: () => Promise<T>) { return local.run(metrics, fn) }
export function newRequestPerformance(): RequestPerformance { return { start: performance.now(), queries: 0, trips: 0, databaseMs: 0 } }
function currentPerformance() {
  const explicit = local.getStore(); if (explicit) return explicit
  try { return useEvent().context.requestPerformance as RequestPerformance | undefined } catch { return undefined }
}
/** Solo segmentos conocidos; jamás registra valores arbitrarios, query, ids o slugs. */
const safeSegments = new Set(['api','auth','login','totp','me','refresh','logout','health','nav','navigation','entities','fields','records','dashboard','metrics','operational','shortcuts','tenant','sites','agenda','availability','settings','options','schedules','users','roles','permissions','index','public','slots','book','booking','cancel','reschedule','config','billing','plans','usage','apps','logo','pages','assets','forms','submit'])
export function normalizedPerformancePath(path: string) { return '/' + path.split('?')[0]!.split('/').filter(Boolean).map(part => safeSegments.has(part) ? part : ':value').join('/') }
export function performanceSummary(event: H3Event, metrics: RequestPerformance, now = performance.now()) {
  return { event: 'slow_request', path: normalizedPerformancePath(event.path), method: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(event.method) ? event.method : 'OTHER', status: event.node.res.statusCode,
    totalMs: Math.round(now-metrics.start), queries: metrics.queries, trips: metrics.trips, databaseMs: Math.round(metrics.databaseMs) }
}
export function performanceHeader(metrics: RequestPerformance, now = performance.now()) { return `app;dur=${(now-metrics.start).toFixed(1)}, db;dur=${metrics.databaseMs.toFixed(1)}, queries;desc="${metrics.queries}", trips;desc="${metrics.trips}"` }

/** Conserva PendingQuery y values(): mide al despachar/resolver, sin SQL ni parámetros. */
export function instrumentDatabase(client: postgres.Sql) {
  const wrapped = new WeakSet<object>()
  const wrap = (scope: postgres.Sql) => {
    if (wrapped.has(scope)) return; wrapped.add(scope)
    const unsafe = scope.unsafe
    scope.unsafe = ((...args: Parameters<typeof unsafe>) => {
      const query = Reflect.apply(unsafe, scope, args) as ReturnType<typeof unsafe>
      if (/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(String(args[0]))) return query
      const metrics = currentPerformance(); if (!metrics) return query
      const internal = query as unknown as { handler: (query: unknown) => unknown; resolve: (value: unknown) => unknown; reject: (value: unknown) => unknown }
      const handler = internal.handler, resolve = internal.resolve, reject = internal.reject
      let start: number | undefined, finished = false
      const finish = () => { if (!finished && start !== undefined) { finished = true; metrics.databaseMs += performance.now()-start } }
      internal.handler = Object.assign((pending: unknown) => { start = performance.now(); metrics.queries++; metrics.trips++; return handler(pending) }, handler)
      internal.resolve = value => { finish(); return resolve(value) }; internal.reject = value => { finish(); return reject(value) }
      return query
    }) as typeof unsafe
  }
  wrap(client)
  const begin = client.begin
  client.begin = ((...args: unknown[]) => {
    const metrics = currentPerformance(), callbackIndex = args.findIndex(arg => typeof arg === 'function')
    const callback = args[callbackIndex] as (scope: postgres.Sql) => Promise<unknown>
    if (!callback) return Reflect.apply(begin, client, args)
    if (metrics) metrics.trips++ // BEGIN
    const start = performance.now(); let boundaryStart = start, entered = false
    args[callbackIndex] = async (scope: postgres.Sql) => {
      entered = true; if (metrics) metrics.databaseMs += performance.now()-start
      wrap(scope)
      try { return await callback(scope) } finally { boundaryStart = performance.now() }
    }
    return Promise.resolve(Reflect.apply(begin, client, args)).finally(() => {
      if (metrics) { if (entered) metrics.trips++; metrics.databaseMs += performance.now()-boundaryStart }
    }) // COMMIT/ROLLBACK; nunca reintenta la transacción
  }) as typeof begin
}
