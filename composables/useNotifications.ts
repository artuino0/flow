export interface NotificationItem {
  id: string
  type: string
  title: string
  message: string
  entitySlug: string | null
  recordId: string | null
  activityId: string | null
  actionUrl: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationState {
  items: NotificationItem[]
  unreadCount: number
  connected: boolean
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let alertAudioContext: AudioContext | null = null

export function useNotifications() {
  const state = useState<NotificationState>('notification-center', () => ({ items: [], unreadCount: 0, connected: false }))
  const realtime = useRealtime()
  let unsubscribeRealtime: (() => void) | null = null
  let active = false

  async function requestAlerts() {
    if (!import.meta.client || !('Notification' in window)) return
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* The browser may block permission prompts. */ }
    }
  }

  function playAlert() {
    if (!import.meta.client) return
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) return
      if (!alertAudioContext) alertAudioContext = new AudioContextCtor() as AudioContext
      if (!alertAudioContext) return
      const context = alertAudioContext
      if (context.state === 'suspended') void context.resume()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(); oscillator.stop(context.currentTime + 0.22)
    } catch { /* Sound is optional and may be blocked by autoplay policy. */ }
  }

  function alertIncoming(item: NotificationItem) {
    if (!import.meta.client) return
    playAlert()
    if (document.visibilityState !== 'hidden' || !('Notification' in window) || Notification.permission !== 'granted') return
    const notification = new Notification(item.title, { body: item.message, tag: `notification-${item.id}` })
    notification.onclick = () => {
      window.focus()
      if (item.actionUrl) void navigateTo(item.actionUrl, { external: !item.actionUrl.startsWith('/') })
      notification.close()
    }
  }

  watch(() => realtime.state.value.connected, connected => { state.value.connected = connected }, { immediate: true })

  async function refresh() {
    if (!import.meta.client) return
    try {
      const response = await $fetch<{ items: NotificationItem[]; unreadCount: number }>('/api/notifications?limit=30')
      state.value.items = response.items
      state.value.unreadCount = response.unreadCount
    } catch {
      // La campana sigue disponible aunque la sesión haya expirado o el
      // servidor esté temporalmente sin responder.
    }
  }

  function addIncoming(item: NotificationItem) {
    if (state.value.items.some(existing => existing.id === item.id)) return
    state.value.items = [item, ...state.value.items].slice(0, 50)
    state.value.unreadCount += 1
    alertIncoming(item)
  }

  function start() {
    if (!import.meta.client || active) return
    active = true
    void refresh()
    unsubscribeRealtime = realtime.subscribe<NotificationItem>('notification.created', event => {
      addIncoming(event.payload)
    })
    realtime.start()
    // Respaldo para reconexiones y despliegues con varias instancias mientras
    // el bus del servidor todavía no se conecte a Redis Pub/Sub.
    pollTimer = setInterval(() => void refresh(), 60_000)
  }

  function stop() {
    if (!active) return
    active = false
    unsubscribeRealtime?.()
    unsubscribeRealtime = null
    realtime.stop()
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    state.value.connected = false
  }

  async function markRead(id: string) {
    const item = state.value.items.find(candidate => candidate.id === id)
    if (!item || item.readAt) return
    item.readAt = new Date().toISOString()
    state.value.unreadCount = Math.max(0, state.value.unreadCount - 1)
    try { await $fetch(`/api/notifications/${id}/read`, { method: 'PATCH' }) } catch { void refresh() }
  }

  async function markAllRead() {
    state.value.items.forEach(item => { item.readAt ||= new Date().toISOString() })
    state.value.unreadCount = 0
    try { await $fetch('/api/notifications/read-all', { method: 'POST' }) } catch { void refresh() }
  }

  return { state, refresh, start, stop, markRead, markAllRead, requestAlerts }
}
