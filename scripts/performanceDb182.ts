import type postgres from 'postgres'

/** Solo arnés local: retrasa cada sentencia y BEGIN/COMMIT, sin simular resultados. */
export function measureLocalDatabase(client: postgres.Sql, active: () => boolean, latencyMs: number, record: (sql: string, parameters: readonly unknown[]) => void) {
  const delay = () => active() && latencyMs > 0 ? new Promise<void>(resolve => setTimeout(resolve, latencyMs)) : Promise.resolve()
  const originalDebug = client.options.debug
  client.options.debug = (connection, query, parameters, types) => {
    if (active()) record(query, parameters)
    if (typeof originalDebug === 'function') originalDebug(connection, query, parameters, types)
  }
  const wrapped = new WeakSet<object>()
  const wrap = (scope: postgres.Sql) => {
    if (wrapped.has(scope)) return
    wrapped.add(scope)
    const unsafe = scope.unsafe
    scope.unsafe = ((...args: Parameters<typeof unsafe>) => {
      const pending = Reflect.apply(unsafe, scope, args) as ReturnType<typeof unsafe>
      // postgres.js abre BEGIN mediante unsafe internamente; el wrapper begin
      // ya aplica su demora. No duplicar la latencia de esa frontera.
      if (/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(String(args[0]))) return pending
      const internal = pending as unknown as { handler: (query: unknown) => unknown }
      const handler = internal.handler
      internal.handler = Object.assign((query: unknown) => { void delay().then(() => handler(query)) }, handler)
      return pending
    }) as typeof unsafe
  }
  wrap(client)
  const begin = client.begin
  client.begin = (async (...args: unknown[]) => {
    const callbackIndex = args.findIndex(arg => typeof arg === 'function')
    const callback = args[callbackIndex] as (scope: postgres.Sql) => Promise<unknown>
    if (!callback) throw new Error('El arnés requiere una transacción con callback')
    await delay()
    args[callbackIndex] = async (scope: postgres.Sql) => {
      wrap(scope)
      try { return await callback(scope) } finally { await delay() }
    }
    return Reflect.apply(begin, client, args)
  }) as typeof begin
  return () => { client.begin = begin; client.options.debug = originalDebug }
}
