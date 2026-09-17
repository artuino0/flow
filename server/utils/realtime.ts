import { EventEmitter } from 'node:events'

export interface RealtimeEnvelope<T = unknown> {
  type: string
  payload: T
  sentAt: string
}

type RealtimeListener = (event: RealtimeEnvelope) => void

// Puente interno entre los servicios que generan eventos y las conexiones
// WebSocket. Es deliberadamente independiente de notificaciones para que la
// misma conexión pueda transportar chat, presencia y otros eventos después.
// En un despliegue con varias instancias este puente se sustituye o alimenta
// desde Redis Pub/Sub sin cambiar el protocolo que consume el navegador.
const realtimeBus = new EventEmitter()
realtimeBus.setMaxListeners(0)

export function realtimeUserTopic(userId: string): string {
  return `user:${userId}`
}

export function makeRealtimeEnvelope<T>(type: string, payload: T): RealtimeEnvelope<T> {
  return { type, payload, sentAt: new Date().toISOString() }
}

export function publishRealtime<T>(topic: string, type: string, payload: T): void {
  realtimeBus.emit(topic, makeRealtimeEnvelope(type, payload))
}

export function subscribeRealtime(topic: string, listener: RealtimeListener): () => void {
  realtimeBus.on(topic, listener)
  return () => realtimeBus.off(topic, listener)
}
