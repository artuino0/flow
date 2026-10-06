import type { Peer } from 'crossws'
import { effectiveHostFromHeaders } from '~/server/utils/effectiveHost'
import { defineWebSocketHandler } from 'h3'
import { AUTH_COOKIE_NAME, resolveAuthToken, type AuthTokenPayload, verifyAuthToken } from '~/server/utils/auth'
import { logger } from '~/server/utils/logger'
import { makeRealtimeEnvelope, realtimeUserTopic, subscribeRealtime } from '~/server/utils/realtime'
import { validateSession } from '~/server/utils/sessions'
import { publishChatPresence, publishTyping } from '~/server/utils/chat'
import { getLicenseStatus } from '~/server/utils/license'
import { assertAccountActive } from '~/server/utils/accountLifecycle'

const HEARTBEAT_MS = 25_000
const STALE_CONNECTION_MS = 75_000
const SESSION_CHECK_MS = 60_000
const MAX_CLIENT_MESSAGE_BYTES = 32_000
const userConnectionCounts = new Map<string, number>()

interface IncomingMessageLike {
  setTimeout?: (ms: number) => void
  socket?: {
    setTimeout?: (ms: number) => void
    setKeepAlive?: (enable: boolean, delay?: number) => void
    server?: { requestTimeout?: number }
  }
}

interface RealtimePeerContext extends Record<string, unknown> {
  auth: AuthTokenPayload
  tokenExpiresAt?: number
  lastPongAt: number
  lastSessionCheckAt: number
  checkingSession: boolean
  unsubscribe?: () => void
  heartbeat?: ReturnType<typeof setInterval>
  presenceRegistered?: boolean
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    try { return decodeURIComponent(value) } catch { return value }
  }
  return undefined
}

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  // Clientes nativos pueden omitir Origin. Siguen necesitando un JWT válido.
  if (!origin) return true

  const configured = (process.env.REALTIME_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
  if (configured.includes(origin.replace(/\/$/, ''))) return true

  try {
    const expectedHost = effectiveHostFromHeaders(name => request.headers.get(name)) || new URL(request.url).host
    return new URL(origin).host === expectedHost
  } catch {
    return false
  }
}

function peerContext(peer: Peer): RealtimePeerContext {
  return peer.context as RealtimePeerContext
}

function keepSocketAlive(peer: Peer) {
  const nodeReq = (peer as Peer & { _internal?: { nodeReq?: IncomingMessageLike } })._internal?.nodeReq
  nodeReq?.setTimeout?.(0)
  nodeReq?.socket?.setTimeout?.(0)
  nodeReq?.socket?.setKeepAlive?.(true, 30_000)
  if (nodeReq?.socket?.server && nodeReq.socket.server.requestTimeout) nodeReq.socket.server.requestTimeout = 0
}

function send(peer: Peer, type: string, payload: unknown): void {
  peer.send(JSON.stringify(makeRealtimeEnvelope(type, payload)))
}

function cleanup(peer: Peer): void {
  const context = peerContext(peer)
  context.unsubscribe?.()
  context.unsubscribe = undefined
  if (context.heartbeat) clearInterval(context.heartbeat)
  context.heartbeat = undefined
  if (context.presenceRegistered) {
    context.presenceRegistered = false
    const remaining = Math.max(0, (userConnectionCounts.get(context.auth.sub) ?? 1) - 1)
    if (remaining) userConnectionCounts.set(context.auth.sub, remaining)
    else {
      userConnectionCounts.delete(context.auth.sub)
      void publishChatPresence(context.auth, false)
    }
  }
}

async function heartbeat(peer: Peer): Promise<void> {
  const context = peerContext(peer)
  const now = Date.now()

  if (!getLicenseStatus().activated) {
    peer.close(4003, 'Instalación sin licencia activa')
    cleanup(peer)
    return
  }

  if (now - context.lastPongAt > STALE_CONNECTION_MS) {
    peer.close(4000, 'Conexión inactiva')
    cleanup(peer)
    return
  }

  send(peer, 'realtime.ping', { at: now })

  if (context.checkingSession || now - context.lastSessionCheckAt < SESSION_CHECK_MS) return
  context.checkingSession = true
  context.lastSessionCheckAt = now
  try {
    await assertAccountActive(context.auth.tenantId)
    await validateSession(context.auth)
  } catch {
    send(peer, 'session.expired', {})
    peer.close(4001, 'Sesión expirada')
    cleanup(peer)
  } finally {
    context.checkingSession = false
  }
}

export default defineWebSocketHandler({
  async upgrade(request) {
    if (!getLicenseStatus().activated) throw new Response('Instalación sin licencia activa', { status: 423 })
    if (!allowedOrigin(request as Request)) throw new Response('Origen no permitido', { status: 403 })

    const token = resolveAuthToken(
      request.headers.get('authorization') ?? undefined,
      readCookie(request.headers.get('cookie'), AUTH_COOKIE_NAME)
    )
    if (!token) throw new Response('No autenticado', { status: 401 })

    try {
      const config = useRuntimeConfig()
      const auth = verifyAuthToken(token, config.jwtSecret as string)
      if ((auth as AuthTokenPayload & { purpose?: string }).purpose) throw new Error('Token pendiente')
      await validateSession(auth)
      await assertAccountActive(auth.tenantId)
      request.context.auth = auth
      request.context.tokenExpiresAt = typeof (auth as AuthTokenPayload & { exp?: number }).exp === 'number'
        ? (auth as AuthTokenPayload & { exp: number }).exp * 1000
        : undefined
    } catch {
      throw new Response('Sesión inválida o expirada', { status: 401 })
    }
  },

  open(peer) {
    keepSocketAlive(peer)
    const context = peerContext(peer)
    const topic = realtimeUserTopic(context.auth.sub)
    context.lastPongAt = Date.now()
    context.lastSessionCheckAt = Date.now()
    context.checkingSession = false
    context.presenceRegistered = true
    const connections = (userConnectionCounts.get(context.auth.sub) ?? 0) + 1
    userConnectionCounts.set(context.auth.sub, connections)
    if (connections === 1) void publishChatPresence(context.auth, true)
    peer.subscribe(topic)
    context.unsubscribe = subscribeRealtime(topic, event => {
      void assertAccountActive(context.auth.tenantId).then(() => peer.send(JSON.stringify(event)), () => { peer.close(4003, 'Cuenta suspendida'); cleanup(peer) })
    })
    context.heartbeat = setInterval(() => void heartbeat(peer), HEARTBEAT_MS)
    send(peer, 'connection.ready', { userId: context.auth.sub, tenantId: context.auth.tenantId })
  },

  async message(peer, message) {
    try { await assertAccountActive(peerContext(peer).auth.tenantId) }
    catch { peer.close(4003, 'Cuenta suspendida'); cleanup(peer); return }
    const raw = message.text()
    if (raw.length > MAX_CLIENT_MESSAGE_BYTES) {
      peer.close(1009, 'Mensaje demasiado grande')
      return
    }
    try {
      const event = JSON.parse(raw) as { type?: string; payload?: Record<string, unknown> }
      if (event.type === 'realtime.pong') {
        peerContext(peer).lastPongAt = Date.now()
      } else if (event.type === 'realtime.ping') {
        send(peer, 'realtime.pong', { at: Date.now() })
      } else if (event.type === 'chat.typing') {
        const conversationId = String(event.payload?.conversationId || '')
        if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw new Error('Conversación inválida')
        await publishTyping(peerContext(peer).auth, conversationId, event.payload?.active === true)
      }
      // Los futuros eventos chat.* se validarán y persistirán aquí antes de
      // publicarse. Los eventos desconocidos se ignoran deliberadamente.
    } catch {
      peer.close(1003, 'Mensaje inválido')
    }
  },

  close(peer) {
    cleanup(peer)
  },

  error(peer, error) {
    cleanup(peer)
    logger.warn('realtime_socket_error', { peerId: peer.id, errorMessage: error.message })
  }
})
