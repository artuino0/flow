interface ShellCache<T> { scope: string; value: T; fetchedAt: number }
interface ShellController { load: (force?: boolean) => Promise<unknown> }
const controllers = new WeakMap<object, Map<string, ShellController>>()

/** Un estado y un observador por recurso/aplicación; ninguna promesa se serializa en SSR. */
export function useShellResource<T>(key: string, url: string, enabled: () => boolean = () => true, deferred = true) {
  const app = useNuxtApp()
  const { user } = useAuth()
  const scope = () => [user.value?.tenantId, user.value?.id, user.value?.roleId, user.value?.sessionId].join(':')
  const cache = useState<ShellCache<T> | null>(`${key}:cache`, () => null)
  const pending = useState(`${key}:pending`, () => false)
  const error = useState<unknown>(`${key}:error`, () => null)
  const status = useState<'idle' | 'pending' | 'success' | 'error'>(`${key}:status`, () => 'idle')
  const data = computed(() => cache.value?.scope === scope() && enabled() ? cache.value.value : null)
  if (!controllers.has(app)) controllers.set(app, new Map())
  const resources = controllers.get(app)!
  if (!resources.has(key)) {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    const afterPaint = useAfterFirstPaint()
    let flight: { scope: string; ticket: object; promise: Promise<T | null> } | undefined
    async function load(force = false): Promise<T | null> {
      if (!user.value?.authenticated || !enabled()) return null
      if (deferred && import.meta.server) return null
      const identity = scope()
      if (!force && cache.value?.scope === identity && Date.now() - cache.value.fetchedAt < 30_000) return cache.value.value
      if (flight?.scope === identity) return flight.promise
      const ticket = {}
      const promise = (async () => {
        try {
          if (deferred) await afterPaint()
          if (scope() !== identity || !enabled()) return null
          pending.value = true; status.value = 'pending'; error.value = null
          const value = await $fetch<T, string>(url, { headers })
          if (scope() === identity && enabled()) {
            cache.value = { scope: identity, value, fetchedAt: Date.now() }; status.value = 'success'
          }
          return scope() === identity && enabled() ? value : null
        } catch (cause) {
          if (scope() === identity) { error.value = cause; status.value = 'error' }
          throw cause
        } finally {
          if (flight?.ticket === ticket) { flight = undefined; pending.value = false }
        }
      })()
      flight = { scope: identity, ticket, promise }
      return promise
    }
    resources.set(key, { load })
    // El observador pertenece a la aplicación, no al primer componente que se desmonte.
    effectScope(true).run(() => watch([scope, enabled], () => { void load().catch(() => undefined) }, { immediate: true }))
  }
  const load = resources.get(key)!.load as (force?: boolean) => Promise<T | null>
  return { data, pending: readonly(pending), error: readonly(error), status: readonly(status),
    refresh: () => load(true), execute: () => load() }
}
