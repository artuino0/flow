import type { FlowAppKey } from '~/utils/flowApps'

export interface FlowAppAccessItem {
  key: FlowAppKey
  enabled: boolean
  accessible: boolean
}

interface FlowAppAccessCache {
  identity: string
  apps: FlowAppAccessItem[]
  fetchedAt: number
}

const ACCESS_TTL_MS = 60_000

export function useFlowAppAccess() {
  const app = useNuxtApp()
  const { user } = useAuth()
  const cache = useState<FlowAppAccessCache | null>('flow-app-access-cache', () => null)
  const pending = useState('flow-app-access-pending', () => false)
  const currentIdentity = () => user.value?.authenticated ? [user.value.tenantId, user.value.id, user.value.roleId, user.value.sessionId].join(':') : ''
  const data = computed(() => cache.value?.identity === currentIdentity() ? { apps: cache.value.apps } : null)

  async function load(force = false) {
    const identity = currentIdentity()
    if (!identity) {
      cache.value = null
      return null
    }

    const fresh = cache.value
      && cache.value.identity === identity
      && Date.now() - cache.value.fetchedAt < ACCESS_TTL_MS
    if (!force && fresh) return { apps: cache.value!.apps }
    const existing = accessFlights.get(app)
    if (existing?.identity === identity) return existing.promise

    pending.value = true
    const ticket = {}
    const promise = (async () => { try {
      const result = await $fetch<{ apps: FlowAppAccessItem[] }>('/api/apps', {
        headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
      })
      if (identity === currentIdentity()) {
        cache.value = { identity, apps: result.apps, fetchedAt: Date.now() }
      }
      return result
    } finally {
      if (accessFlights.get(app)?.ticket === ticket) { pending.value = false; accessFlights.delete(app) }
    }
    })()
    accessFlights.set(app, { identity, ticket, promise })
    return promise
  }

  function invalidate() {
    cache.value = null
  }

  return { data, pending: readonly(pending), load, invalidate }
}
const accessFlights = new WeakMap<object, { identity: string; ticket: object; promise: Promise<{ apps: FlowAppAccessItem[] }> }>()
