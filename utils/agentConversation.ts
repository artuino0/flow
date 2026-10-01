export type AgentAction = { kind: 'navigate'; path: string } | { kind: 'point'; anchor: string } | { kind: 'start-tour'; tourId: string }
export interface AgentReply { reply: string; emotion: 'idle' | 'happy' | 'special'; actions: AgentAction[]; layer: 'catalog' | 'ai' | 'offtopic' | 'limited' | 'unavailable'; retryAfterSec?: number | null }
export function normalizeAgentMessage(text: string) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¡!¿?. ,]+/g, ' ').trim() }
export function courtesyReply(text: string): AgentReply | null {
 const message = normalizeAgentMessage(text)
 if (/^(hola|buenos dias|buenas tardes|buenas noches|hey|saludos)$/.test(message)) return { reply: '¡Hola! Soy Chattito. ¿Qué quieres conocer de Flow?', emotion: 'happy', actions: [], layer: 'catalog' }
 if (/^(gracias|muchas gracias|perfecto|genial|listo|adios|hasta luego)$/.test(message)) return { reply: '¡Con gusto! Aquí sigo para acompañarte en Flow.', emotion: 'special', actions: [], layer: 'catalog' }
 return null
}
export function agentHistory(messages: readonly { role: 'user' | 'assistant'; text: string }[]) {
 return messages.filter(message => message.text.trim()).slice(-8).map(message => ({ role: message.role, text: message.text.slice(0, 700) }))
}
