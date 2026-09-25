import type { Ref } from 'vue'
import { realtimeReconnectDelay, realtimeRefreshRequiresSession, shouldConnectRealtime } from '~/utils/realtimeRetry'

export interface ClientRealtimeEnvelope<T = unknown> {
  type: string
  payload: T
  sentAt: string
}

interface RealtimeConnectionState {
  connected: boolean
  reconnecting: boolean
  everConnected: boolean
  transport: 'unknown' | 'websocket' | 'polling'
}

type RealtimeListener = (event: ClientRealtimeEnvelope) => void

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempt = 0
let consumerCount = 0
let stopped = true
let sessionRequired = false
let currentState: Ref<RealtimeConnectionState> | null = null
let transportPromise: Promise<'websocket' | 'polling'> | null = null
const listeners = new Map<string, Set<RealtimeListener>>()

function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/realtime`
}

function dispatch(event: ClientRealtimeEnvelope) {
  for (const listener of listeners.get(event.type) ?? []) listener(event)
  for (const listener of listeners.get('*') ?? []) listener(event)
}

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function startPolling() {
  if (pollTimer) return
  const poll = () => {
    if (!stopped && document.visibilityState === 'visible') {
      dispatch({ type: 'realtime.poll', payload: null, sentAt: new Date().toISOString() })
    }
  }
  poll()
  pollTimer = setInterval(poll, 8_000)
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

async function refreshAccessCookie() {
  try {
    await $fetch('/api/auth/refresh', { method: 'POST' })
    return true
  } catch (error) {
    if (realtimeRefreshRequiresSession(error)) {
      sessionRequired = true
      if (currentState) {
        currentState.value.connected = false
        currentState.value.reconnecting = false
      }
      clearReconnect()
      return false
    }
    return true
  }
}

async function resolveTransport(): Promise<'websocket' | 'polling'> {
  if (!transportPromise) {
    transportPromise = $fetch<{ realtimeTransport?: 'websocket' | 'polling' }>('/api/config')
      .then(config => config.realtimeTransport === 'polling' ? 'polling' : 'websocket')
      .catch(() => window.location.hostname.endsWith('.vercel.app') ? 'polling' : 'websocket')
  }
  return transportPromise
}

function scheduleReconnect(state: Ref<RealtimeConnectionState>) {
  if (!shouldConnectRealtime(stopped, sessionRequired) || reconnectTimer || !navigator.onLine) return
  if (state.value.everConnected) state.value.reconnecting = true
  const delay = realtimeReconnectDelay(reconnectAttempt)
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect(state)
  }, delay)
}

async function connect(state: Ref<RealtimeConnectionState>) {
  if (!import.meta.client || !shouldConnectRealtime(stopped, sessionRequired) || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  clearReconnect()
  const transport = await resolveTransport()
  state.value.transport = transport
  if (transport === 'polling') {
    state.value.connected = false
    state.value.reconnecting = false
    startPolling()
    return
  }
  const refreshed = await refreshAccessCookie()
  if (!refreshed || stopped || sessionRequired || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return

  const next = new WebSocket(websocketUrl())
  socket = next
  next.addEventListener('open', () => {
    if (socket !== next) return
    reconnectAttempt = 0
    state.value.connected = true
    state.value.everConnected = true
    state.value.reconnecting = false
  })
  next.addEventListener('message', message => {
    if (socket !== next || typeof message.data !== 'string') return
    try {
      const event = JSON.parse(message.data) as ClientRealtimeEnvelope
      if (!event || typeof event.type !== 'string') return
      if (event.type === 'realtime.ping') {
        next.send(JSON.stringify({ type: 'realtime.pong', payload: { at: Date.now() } }))
        return
      }
      dispatch(event)
    } catch {
      // Un mensaje malformado del servidor se ignora; la siguiente consulta
      // HTTP de cada consumidor sigue siendo la fuente de verdad.
    }
  })
  next.addEventListener('close', () => {
    if (socket !== next) return
    socket = null
    state.value.connected = false
    scheduleReconnect(state)
  })
  next.addEventListener('error', () => {
    // `close` centraliza el estado y la reconexión. Algunos navegadores no
    // emiten close inmediatamente después de un upgrade rechazado.
    if (next.readyState === WebSocket.OPEN) next.close()
  })
}

function wakeConnection() {
  if (!currentState || stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  reconnectAttempt = 0
  void connect(currentState)
}

function resumeSession() {
  if (stopped) return
  sessionRequired = false
  reconnectAttempt = 0
  clearReconnect()
  wakeConnection()
}

export function useRealtime() {
  const state = useState<RealtimeConnectionState>('realtime-connection', () => ({ connected: false, reconnecting: false, everConnected: false, transport: 'unknown' }))
  let active = false

  function start() {
    if (!import.meta.client || active) return
    active = true
    consumerCount += 1
    currentState = state
    if (consumerCount === 1) {
      stopped = false
      sessionRequired = false
      window.addEventListener('online', wakeConnection)
      document.addEventListener('visibilitychange', wakeConnection)
      void connect(state)
    }
  }

  function stop() {
    if (!import.meta.client || !active) return
    active = false
    consumerCount = Math.max(0, consumerCount - 1)
    if (consumerCount > 0) return
    stopped = true
    clearReconnect()
    stopPolling()
    window.removeEventListener('online', wakeConnection)
    document.removeEventListener('visibilitychange', wakeConnection)
    const current = socket
    socket = null
    current?.close(1000, 'Sin consumidores activos')
    state.value.connected = false
    state.value.reconnecting = false
  }

  function subscribe<T = unknown>(type: string, listener: (event: ClientRealtimeEnvelope<T>) => void): () => void {
    const typeListeners = listeners.get(type) ?? new Set<RealtimeListener>()
    const compatible = listener as RealtimeListener
    typeListeners.add(compatible)
    listeners.set(type, typeListeners)
    return () => {
      typeListeners.delete(compatible)
      if (!typeListeners.size) listeners.delete(type)
    }
  }

  function send(type: string, payload: unknown): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({ type, payload }))
    return true
  }

  return { state, start, stop, subscribe, send, resumeSession }
}
