import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { CHATTITO_DEFAULTS, chattitoSessionIdentity, chooseChattitoIdleGesture, emotionForMessage, isAnimatedChattitoMessage, lookAtElement, nextChattitoIdleDelay } from '../../utils/chattito'
import { CHATTITO_MAX_WIDTH, CHATTITO_MIN_WIDTH, normalizeChattitoWidth, useChattitoPanel } from '../../composables/useChattitoPanel'

describe('lookAtElement', () => {
  it('devuelve el centro del elemento en coordenadas del viewport', () => {
    const element = { getBoundingClientRect: () => ({ left: 12, top: 25, width: 80, height: 40 }) } as Element
    expect(lookAtElement(element)).toEqual({ x: 52, y: 45 })
  })
})

describe('isAnimatedChattitoMessage', () => {
  it('anima solo el último mensaje de Chattito', () => {
    expect([0, 1, 2, 3].map(index => isAnimatedChattitoMessage(index, 3))).toEqual([false, false, false, true])
    expect(isAnimatedChattitoMessage(2, -1)).toBe(false)
  })
})

describe('gestos automáticos', () => {
  it('espacia los gestos entre 6 y 12 segundos y alterna mirada con felicidad ocasional', () => {
    expect(nextChattitoIdleDelay(0)).toBe(6000)
    expect(nextChattitoIdleDelay(1)).toBe(12000)
    expect(chooseChattitoIdleGesture(0.2)).toBe('left')
    expect(chooseChattitoIdleGesture(0.6)).toBe('right')
    expect(chooseChattitoIdleGesture(0.9)).toBe('happy')
  })
})

describe('identidad de sesión', () => {
  it('distingue usuario, organización y sesión; oculta Chattito sin autenticación', () => {
    const current = { authenticated: true, id: 'usuario-1', tenantId: 'org-1', sessionId: 'sesion-1' }
    expect(chattitoSessionIdentity(null)).toBeNull()
    expect(chattitoSessionIdentity({ ...current, authenticated: false })).toBeNull()
    expect(chattitoSessionIdentity({ ...current, id: 'usuario-2' })).not.toBe(chattitoSessionIdentity(current))
    expect(chattitoSessionIdentity({ ...current, tenantId: 'org-2' })).not.toBe(chattitoSessionIdentity(current))
    expect(chattitoSessionIdentity({ ...current, sessionId: 'sesion-2' })).not.toBe(chattitoSessionIdentity(current))
  })
})

describe('ancho del panel', () => {
  it('limita el ancho entre el tamaño original y el 150 %', () => {
    expect(CHATTITO_MAX_WIDTH).toBe(CHATTITO_MIN_WIDTH * 1.5)
    expect(normalizeChattitoWidth(300)).toBe(400)
    expect(normalizeChattitoWidth(475.7)).toBe(476)
    expect(normalizeChattitoWidth(700)).toBe(600)
    expect(normalizeChattitoWidth(Number.NaN)).toBe(400)
  })
})

describe('emotionForMessage', () => {
  it.each(['GRACIAS', 'Listo, gracias.', 'MUCHAS GRACIAS', 'perfectó', 'VA', 'ok', 'De acuerdo', 'Sí acepto'])('reconoce un agradecimiento o aceptación: %s', text => {
    expect(emotionForMessage(text, false)).toBe('special')
  })

  it.each(['hola', '¡HOLA!', 'buenas tardes', 'buen día', 'qué tal'])('reconoce un saludo: %s', text => {
    expect(emotionForMessage(text, false)).toBe('happy')
  })

  it('anima con happy el primer mensaje y deja idle el resto', () => {
    expect(emotionForMessage('¿Cómo está el tablero?', true)).toBe('happy')
    expect(emotionForMessage('Revisa el tablero', false)).toBe('idle')
  })
})

describe('useChattitoPanel', () => {
  let stateStore: Map<string, ReturnType<typeof ref>>
  beforeEach(() => {
    stateStore = new Map()
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!stateStore.has(key)) stateStore.set(key, ref(init()))
      return stateStore.get(key)
    })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('conserva apertura y conversación entre montajes del composable', () => {
    const firstMount = useChattitoPanel()
    firstMount.toggle()
    firstMount.addMessage({ role: 'user', text: 'Seguimos aquí' })
    const nextRoute = useChattitoPanel()
    expect(nextRoute.panel.value.open).toBe(true)
    expect(nextRoute.panel.value.messages.at(-1)?.text).toBe('Seguimos aquí')
  })

  it('reinicia mensajes, apertura y ancho al terminar o cambiar de sesión', () => {
    const chat = useChattitoPanel()
    chat.toggle()
    chat.addMessage({ role: 'user', text: 'Dato de sesión anterior' })
    chat.setWidth(550)
    chat.reset()
    expect(chat.panel.value.open).toBe(false)
    expect(chat.panel.value.width).toBe(CHATTITO_MIN_WIDTH)
    expect(chat.panel.value.messages).toHaveLength(3)
    expect(chat.panel.value.messages.some(message => message.text === 'Dato de sesión anterior')).toBe(false)
    expect(chat.panel.value.avatarState).toBe('idle')
  })

  it.each([
    ['happy', CHATTITO_DEFAULTS.happyDuration],
    ['special', CHATTITO_DEFAULTS.joyDuration],
  ] as const)('devuelve %s a idle al completar la animación', (emotion, duration) => {
    vi.useFakeTimers()
    const chat = useChattitoPanel()
    chat.setAvatarState(emotion)
    expect(chat.panel.value.avatarState).toBe(emotion)
    vi.advanceTimersByTime(duration - 1)
    expect(chat.panel.value.avatarState).toBe(emotion)
    vi.advanceTimersByTime(1)
    expect(chat.panel.value.avatarState).toBe('idle')
  })

  it('cancela el regreso anterior al comenzar otra respuesta o reiniciar la sesión', () => {
    vi.useFakeTimers()
    const chat = useChattitoPanel()
    chat.setAvatarState('happy')
    vi.advanceTimersByTime(100)
    chat.setAvatarState('typing')
    vi.advanceTimersByTime(CHATTITO_DEFAULTS.happyDuration)
    expect(chat.panel.value.avatarState).toBe('typing')
    chat.setAvatarState('special')
    useChattitoPanel().reset()
    vi.advanceTimersByTime(CHATTITO_DEFAULTS.joyDuration)
    expect(chat.panel.value.avatarState).toBe('idle')
  })
})
