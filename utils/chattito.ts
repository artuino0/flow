export type ChattitoState = 'idle' | 'happy' | 'typing' | 'special'
export type ChattitoPoint = { x: number; y: number }
/** Coordenadas del viewport, como clientX/clientY y getBoundingClientRect(). */
export type ChattitoLookAt = 'left' | 'right' | 'center' | ChattitoPoint
export type ChattitoBounds = { left: number; top: number; width: number; height: number }
export type ChattitoEmotion = 'special' | 'happy' | 'idle'
export type ChattitoIdleGesture = 'left' | 'right' | 'happy'

export function chattitoSessionIdentity(user: { authenticated: boolean; id: string; tenantId: string; sessionId?: string } | null | undefined) {
  return user?.authenticated ? JSON.stringify([user.id, user.tenantId, user.sessionId ?? null]) : null
}

export function nextChattitoIdleDelay(random: number) {
  return 6000 + Math.round(random * 6000)
}

export function chooseChattitoIdleGesture(random: number): ChattitoIdleGesture {
  return random < 0.4 ? 'left' : random < 0.8 ? 'right' : 'happy'
}

export const CHATTITO_DEFAULTS = Object.freeze({
  breathingDistance: 3,
  breathingDuration: 3500,
  blinkDuration: 120,
  blinkMinInterval: 3000,
  blinkMaxInterval: 6000,
  doubleBlinkChance: 0.2,
  doubleBlinkGap: 160,
  reducedBlinkDuration: 360,
  reducedBlinkInterval: 8000,
  pupilDistance: 4,
  headRotation: 5,
  springStiffness: 170,
  springDamping: 22,
  happyDuration: 600,
  happyJump: 8,
  happySquash: 0.95,
  happyStretch: 1.05,
  antennaRotation: 12,
  antennaCycles: 2,
  typingDuration: 1400,
  typingDistance: 6,
  transitionDuration: 250,
  joyDuration: 3200,
  joyHeight: 26,
  joySway: 5,
  joyRotation: 4,
})

export type ChattitoConfig = typeof CHATTITO_DEFAULTS

/** Devuelve el centro del elemento en coordenadas del viewport. */
export function lookAtElement(el: Pick<Element, 'getBoundingClientRect'>): ChattitoPoint {
  const bounds = el.getBoundingClientRect()
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
}

export function calculateChattitoLook(lookAt: ChattitoLookAt, bounds: ChattitoBounds, config: ChattitoConfig = CHATTITO_DEFAULTS) {
  let x = 0
  let y = 0
  if (typeof lookAt === 'string') {
    x = lookAt === 'left' ? -1 : lookAt === 'right' ? 1 : 0
  } else if (Number.isFinite(lookAt.x) && Number.isFinite(lookAt.y)) {
    x = (lookAt.x - (bounds.left + bounds.width / 2)) / Math.max(1, bounds.width / 2)
    y = (lookAt.y - (bounds.top + bounds.height / 2)) / Math.max(1, bounds.height / 2)
    const magnitude = Math.max(1, Math.hypot(x, y))
    x /= magnitude
    y /= magnitude
  }
  return { x: x * config.pupilDistance, y: y * config.pupilDistance, rotation: x * config.headRotation }
}

const SPECIAL_PHRASES = ['muchas gracias', 'mil gracias', 'gracias', 'va', 'ok', 'perfecto', 'de acuerdo', 'sí acepto', 'acepto']
const GREETING_PHRASES = ['hola', 'buenas', 'buen día', 'buenos días', 'qué tal']

function normalizeSpanish(text: string) {
  return text.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function containsPhrase(text: string, phrases: string[]) {
  const words = ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  return phrases.some(phrase => words.includes(` ${normalizeSpanish(phrase)} `))
}

/** Emoción base para mensajes de la conversación; la IA podrá sustituir esta regla. */
export function emotionForMessage(texto: string, esPrimerMensaje: boolean): ChattitoEmotion {
  const normalized = normalizeSpanish(texto).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (containsPhrase(normalized, SPECIAL_PHRASES)) return 'special'
  if (esPrimerMensaje || containsPhrase(normalized, GREETING_PHRASES)) return 'happy'
  return 'idle'
}

/** Regla compartida para que solo el último mensaje de Chattito anime. */
export function isAnimatedChattitoMessage(index: number, lastChattitoIndex: number) {
  return index === lastChattitoIndex
}

export interface ChattitoMachine { state: ChattitoState; revision: number }
export type ChattitoEvent = { type: 'request'; state: ChattitoState } | { type: 'emotion-finished'; revision: number }

export function chattitoTransientDuration(state: ChattitoState) {
  if (state === 'happy') return CHATTITO_DEFAULTS.happyDuration
  if (state === 'special') return CHATTITO_DEFAULTS.joyDuration
  return null
}

/** El identificador evita que un temporizador viejo interrumpa un estado nuevo. */
export function transitionChattito(machine: ChattitoMachine, event: ChattitoEvent): ChattitoMachine {
  if (event.type === 'request') return { state: event.state, revision: machine.revision + 1 }
  if (chattitoTransientDuration(machine.state) !== null && machine.revision === event.revision) {
    return { state: 'idle', revision: machine.revision + 1 }
  }
  return machine
}

export function chattitoSpringFrames(stiffness: number, damping: number) {
  const values = [0]
  const dt = 1 / 120
  let position = 0
  let velocity = 0
  for (let step = 1; step <= 600; step++) {
    velocity += (stiffness * (1 - position) - damping * velocity) * dt
    position += velocity * dt
    values.push(position)
    if (Math.abs(1 - position) < 0.001 && Math.abs(velocity) < 0.001) break
  }
  values[values.length - 1] = 1
  return { values, duration: (values.length - 1) * dt * 1000 }
}
