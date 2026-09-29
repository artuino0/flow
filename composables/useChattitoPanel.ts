import type { ChattitoEmotion, ChattitoState } from '~/utils/chattito'
import { chattitoTransientDuration, transitionChattito } from '~/utils/chattito'

export interface ChattitoMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  emotion?: ChattitoEmotion | 'typing'
}

const initialMessages: ChattitoMessage[] = [
  { id: 1, role: 'assistant', text: '¡Hola! Soy Chattito. Este espacio conservará nuestra conversación mientras navegas por Flow.' },
  { id: 2, role: 'user', text: '¿Me acompañas mientras reviso mis pendientes?' },
  { id: 3, role: 'assistant', text: 'Claro. Escribe algo para probar mis gestos y el indicador de escritura.' },
]

export const CHATTITO_MIN_WIDTH = 400
export const CHATTITO_MAX_WIDTH = 600
const WIDTH_STORAGE_KEY = 'flow-chattito-panel-width'

export function normalizeChattitoWidth(width: number) {
  return Number.isFinite(width) ? Math.round(Math.min(CHATTITO_MAX_WIDTH, Math.max(CHATTITO_MIN_WIDTH, width))) : CHATTITO_MIN_WIDTH
}

function initialPanel() {
  return {
    open: false,
    nextId: 4,
    messages: initialMessages.map(message => ({ ...message })),
    avatarState: 'idle' as ChattitoEmotion | 'typing',
    avatarRevision: 0,
    width: CHATTITO_MIN_WIDTH,
    resizing: false,
  }
}

export function useChattitoPanel() {
  const panel = useState('chattito-panel', initialPanel)
  let emotionTimer: ReturnType<typeof setTimeout> | undefined

  function disposeAvatarStateTimer() {
    if (emotionTimer) clearTimeout(emotionTimer)
    emotionTimer = undefined
  }

  function setAvatarState(state: ChattitoState) {
    disposeAvatarStateTimer()
    const next = transitionChattito({ state: panel.value.avatarState, revision: panel.value.avatarRevision }, { type: 'request', state })
    panel.value.avatarState = next.state
    panel.value.avatarRevision = next.revision
    const duration = chattitoTransientDuration(state)
    if (duration === null) return
    emotionTimer = setTimeout(() => {
      emotionTimer = undefined
      const settled = transitionChattito({ state: panel.value.avatarState, revision: panel.value.avatarRevision }, { type: 'emotion-finished', revision: next.revision })
      panel.value.avatarState = settled.state
      panel.value.avatarRevision = settled.revision
    }, duration)
  }

  function toggle() { panel.value.open = !panel.value.open }
  function close() { panel.value.open = false }
  function setWidth(width: number) { panel.value.width = normalizeChattitoWidth(width) }
  function restoreWidth() {
    if (!import.meta.client) return
    try {
      const saved = localStorage.getItem(WIDTH_STORAGE_KEY)
      if (saved !== null) setWidth(Number(saved))
    } catch {
      // El panel sigue disponible con el ancho por defecto.
    }
  }
  function saveWidth() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(panel.value.width))
    } catch {
      // El cambio de ancho sigue funcionando durante esta sesión.
    }
  }
  function reset() {
    disposeAvatarStateTimer()
    panel.value = { ...initialPanel(), avatarRevision: panel.value.avatarRevision + 1 }
    if (!import.meta.client) return
    try {
      localStorage.removeItem(WIDTH_STORAGE_KEY)
    } catch {
      // El estado en memoria ya quedó reiniciado.
    }
  }
  function addMessage(message: Omit<ChattitoMessage, 'id'>) {
    const next = { ...message, id: panel.value.nextId++ }
    panel.value.messages.push(next)
    if (panel.value.messages.length > 60) panel.value.messages.splice(0, panel.value.messages.length - 60)
    return next
  }

  return { panel, toggle, close, addMessage, setAvatarState, disposeAvatarStateTimer, setWidth, restoreWidth, saveWidth, reset }
}
