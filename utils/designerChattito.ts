import { emotionForMessage, type ChattitoState } from './chattito'

/** Estado de presentación propio del diseñador; no utiliza el panel global. */
export function designerChattitoState(moment: {
  generating: boolean
  error: boolean
  applied: boolean
  validProposal: boolean
  welcome: boolean
  userText: string
  assistantText: string
}): ChattitoState {
  if (moment.generating) return 'typing'
  if (moment.error) return 'idle'
  if (moment.applied) return 'special'
  const userEmotion = emotionForMessage(moment.userText, false)
  if (userEmotion === 'special') return 'special'
  if (moment.validProposal || moment.welcome || userEmotion === 'happy') return 'happy'
  // Solo el saludo del asistente, no sus posibles expresiones de aceptación.
  return emotionForMessage(moment.assistantText, false) === 'happy' ? 'happy' : 'idle'
}

export function isAnimatedDesignerChattitoMessage(message: { id: string; role: 'user' | 'assistant' }, lastAssistantId: string | undefined): boolean {
  return message.role === 'assistant' && message.id === lastAssistantId
}
