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
  const { user } = useAuth()
  const cache = useState<FlowAppAccessCache | null>('flow-app-access-cache', () => null)
  const pending = useState('flow-app-access-pending', () => false)
  const data = computed(() => cache.value ? { apps: cache.value.apps } : null)

  async function load(force = false) {
    const identity = user.value?.authenticated ? `${user.value.tenantId}:${user.value.id}` : ''
    if (!identity) {
      cache.value = null
      return null
    }

    const fresh = cache.value
      && cache.value.identity === identity
      && Date.now() - cache.value.fetchedAt < ACCESS_TTL_MS
    if (!force && fresh) return { apps: cache.value!.apps }

    pending.value = true
    try {
      const result = await $fetch<{ apps: FlowAppAccessItem[] }>('/api/apps', {
        headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
      })
      cache.value = { identity, apps: result.apps, fetchedAt: Date.now() }
      return result
    } finally {
      pending.value = false
    }
  }

  function invalidate() {
    cache.value = null
  }

  return { data, pending: readonly(pending), load, invalidate }
}
