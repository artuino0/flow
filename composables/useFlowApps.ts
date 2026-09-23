import { FLOW_APPS, resolveFlowApp, type FlowAppKey } from '~/utils/flowApps'

const STORAGE_KEY = 'flow-last-app-routes'
const CONTEXT_STORAGE_KEY = 'flow-active-context-app'

function isGlobalChatRoute(path: string) {
  return path === '/chat' || path.startsWith('/chat/')
}

export function useFlowApps() {
  const route = useRoute()
  const lastRoutes = useState<Partial<Record<FlowAppKey, string>>>('flow-last-app-routes', () => ({}))
  const restored = useState('flow-last-app-routes-restored', () => false)
  const contextKey = useState<FlowAppKey>('flow-active-context-app', () => 'core')
  const activeKey = computed(() => isGlobalChatRoute(route.path) ? contextKey.value : resolveFlowApp(route.path))
  const activeApp = computed(() => FLOW_APPS[activeKey.value])

  function restore() {
    if (!import.meta.client || restored.value) return
    restored.value = true
    try {
      const savedContext = localStorage.getItem(CONTEXT_STORAGE_KEY)
      if (savedContext && savedContext in FLOW_APPS) contextKey.value = savedContext as FlowAppKey
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>
      for (const key of Object.keys(FLOW_APPS) as FlowAppKey[]) {
        const candidate = value[key]
        if (typeof candidate === 'string' && resolveFlowApp(candidate.split('?')[0]) === key) lastRoutes.value[key] = candidate
      }
    } catch {
      lastRoutes.value = {}
    }
  }

  function remember(path: string) {
    if (!import.meta.client) return
    const key = resolveFlowApp(path.split('?')[0])
    lastRoutes.value[key] = path
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lastRoutes.value)) } catch { /* Preferencia opcional. */ }
  }

  async function openApp(key: FlowAppKey) {
    contextKey.value = key
    if (import.meta.client) {
      try { localStorage.setItem(CONTEXT_STORAGE_KEY, key) } catch { /* Preferencia opcional. */ }
    }
    const saved = lastRoutes.value[key]
    const target = saved && resolveFlowApp(saved.split('?')[0]) === key ? saved : FLOW_APPS[key].home
    if (route.fullPath !== target) await navigateTo(target)
  }

  onMounted(restore)
  watch(() => route.fullPath, (path) => {
    const pathname = path.split('?')[0]
    if (!isGlobalChatRoute(pathname)) {
      contextKey.value = resolveFlowApp(pathname)
      if (import.meta.client) {
        try { localStorage.setItem(CONTEXT_STORAGE_KEY, contextKey.value) } catch { /* Preferencia opcional. */ }
      }
    }
    remember(path)
  }, { immediate: true })

  return { activeKey, activeApp, lastRoutes, openApp }
}


