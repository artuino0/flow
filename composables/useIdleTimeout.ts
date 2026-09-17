const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

export function useIdleTimeout(onTimeout: () => void | Promise<void>) {
  const { refresh, user } = useAuth()
  const warningSeconds = computed(() => (user.value?.idleWarningMinutes ?? 2) * 60)
  const timeoutMs = computed(() => (user.value?.idleTimeoutMinutes ?? 30) * 60_000)
  const showWarning = ref(false)
  const countdown = ref(warningSeconds.value)
  let lastActivity = Date.now()
  let lastRefresh = 0
  let refreshing = false
  let tickHandle: ReturnType<typeof setInterval> | null = null
  const storageKey = computed(() => 'flow-activity-' + user.value?.tenantId + '-' + (user.value?.sessionId || user.value?.email))
  let lastStored = 0

  function markActivity() {
    if (showWarning.value) return
    lastActivity = Date.now()
    if (lastActivity - lastStored > 1000) {
      lastStored = lastActivity
      try { localStorage.setItem(storageKey.value, String(lastActivity)) } catch {}
    }
  }
  function syncActivity(event: StorageEvent) {
    if (event.key !== storageKey.value) return
    const time = Number(event.newValue)
    if (Number.isFinite(time) && time > lastActivity && time <= Date.now()) {
      lastActivity = time
      showWarning.value = false
    }
  }
  async function silentRefresh() {
    if (refreshing) return
    refreshing = true
    lastRefresh = Date.now()
    try { await refresh() } catch { stop(); await onTimeout() }
    finally { refreshing = false }
  }
  function tick() {
    const now = Date.now()
    const remaining = timeoutMs.value - (now - lastActivity)
    countdown.value = Math.max(0, Math.ceil(remaining / 1000))
    if (remaining <= 0) { stop(); void onTimeout(); return }
    showWarning.value = remaining <= warningSeconds.value * 1000
    // Only real recent activity renews a managed session.
    if (!showWarning.value && now - lastActivity < 30_000 && now - lastRefresh >= 30_000) void silentRefresh()
  }
  function confirmActive() {
    if (Date.now() - lastActivity >= timeoutMs.value) { stop(); void onTimeout(); return }
    showWarning.value = false
    markActivity()
    countdown.value = warningSeconds.value
    void silentRefresh()
  }
  function stop() {
    if (tickHandle !== null) clearInterval(tickHandle)
    tickHandle = null
    if (import.meta.client) {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActivity)
      window.removeEventListener('storage', syncActivity)
    }
  }
  onMounted(() => {
    try { const previous = Number(localStorage.getItem(storageKey.value)); if (previous > 0 && previous <= Date.now()) lastActivity = previous } catch {}
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, markActivity, { passive: true })
    window.addEventListener('storage', syncActivity)
    tick()
    tickHandle = setInterval(tick, 1000)
  })
  onUnmounted(stop)
  return { showWarning, countdown, warningSeconds, confirmActive }
}
