/** Deja terminar la navegación y dos frames antes del trabajo secundario. */
export function useAfterFirstPaint() {
  const app = useNuxtApp()
  const dashboardPending = useState('dashboard-first-paint-pending', () => false)
  const navigationPending = useState('auth-navigation-pending', () => false)
  const user = useState<{ id: string; tenantId: string; roleId: string | null; sessionId?: string } | null>('auth-user', () => null)
  const pending = computed(() => dashboardPending.value || navigationPending.value)
  if (import.meta.server) return async () => {}
  return () => {
    const scope = [user.value?.tenantId, user.value?.id, user.value?.roleId, user.value?.sessionId].join(':')
    let wait = paintWaits.get(app)
    if (!wait || wait.scope !== scope) {
      const promise = new Promise<void>(resolve => {
        const afterFrames = () => {
          if (pending.value) {
            const stop = watch(pending, value => { if (!value) { stop(); afterFrames() } })
            return
          }
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 500 })
            else setTimeout(resolve, 50)
          }))
        }
        app.runWithContext(() => onNuxtReady(afterFrames))
      })
      wait = { scope, promise }
      paintWaits.set(app, wait)
    }
    return wait.promise
  }
}
const paintWaits = new WeakMap<object, { scope: string; promise: Promise<void> }>()
