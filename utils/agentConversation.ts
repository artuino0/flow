export type AgentAction = { kind: 'navigate'; path: string } | { kind: 'point'; anchor: string } | { kind: 'start-tour'; tourId: string }
import type { ChattitoEmotion } from './chattito'
export interface AgentReply { reply: string; emotion: ChattitoEmotion; actions: AgentAction[]; layer: 'catalog' | 'ai' | 'offtopic' | 'limited' | 'unavailable'; retryAfterSec?: number | null }
export type AgentTurn = { role: 'user' | 'assistant'; text: string }
export interface AgentReplyContext { message?: string; history?: readonly AgentTurn[] }
export function normalizeAgentMessage(text: string) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¡!¿?.,;]/g, ' ').replace(/\s+/g, ' ').trim() }

/** Pura y determinista; el último turno evita repetir una respuesta consecutiva. */
export function chooseAgentVariant(variants: readonly string[], context: AgentReplyContext = {}) {
 const history = context.history || []
 let hash = 0
 for (const char of normalizeAgentMessage(context.message || '')) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
 let index = (hash + history.length) % variants.length
 const previous = [...history].reverse().find(turn => turn.role === 'assistant')?.text
 if (variants[index] === previous) index = (index + 1) % variants.length
 return variants[index]!
}
export const courtesyFamilies = [
 { pattern: /^(hola|buenos dias|buen dia|buenas tardes|buenas noches|hey|que onda|buenas|saludos|holi)$/, emotion: 'happy', replies: [
  '¡Hola! Qué gusto verte por aquí. ¿En qué te ayudo con Flow?',
  '¡Hola! Aquí está Chattito para acompañarte. ¿Qué quieres descubrir en Flow?',
  '¡Qué gusto saludarte! ¿Te llevo a una pantalla de Flow o vemos un recorrido?'
 ] },
 { pattern: /^(como estas|que tal|como te va|como andas|como amaneciste|que cuentas)$/, emotion: 'happy', replies: [
  '¡Muy bien, gracias por preguntar! Y tú, ¿cómo vas? ¿En qué te puedo ayudar hoy con Flow?',
  '¡Feliz de verte por aquí! Gracias por preguntar. ¿Cómo va tu día? ¿Te ayudo con algo de Flow?',
  '¡Con muchas ganas de acompañarte! ¿Cómo estás tú? Cuéntame qué quieres conocer de Flow.'
 ] },
 { pattern: /^(bien|muy bien|todo bien|excelente)$/, emotion: 'happy', replies: [
  '¡Me alegra saberlo! ¿En qué te puedo ayudar con Flow hoy?',
  '¡Qué bueno! Aquí estoy para acompañarte. ¿Qué quieres explorar en Flow?'
 ] },
 { pattern: /^(mal|muy mal|triste)$/, emotion: 'happy', replies: [
  'Siento que estés pasando un mal rato. Vamos a tu ritmo; ¿te ayudo con algo de Flow?',
  'Gracias por contármelo. Aquí estoy para acompañarte; ¿hay algo de Flow que pueda hacerte más fácil el día?'
 ] },
 { pattern: /^(cansado|cansada|agotado|agotada)$/, emotion: 'happy', replies: [
  'Suena a un día pesado. Vamos paso a paso; ¿te ayudo a encontrar algo en Flow?',
  'Un poco de calma viene bien. Te acompaño con algo sencillo; ¿qué necesitas en Flow?'
 ] },
 { pattern: /^(gracias|muchas gracias|mil gracias|perfecto|genial|listo|ok|okay|va|de nada|de acuerdo|si acepto|acepto)$/, emotion: 'special', replies: [
  '¡Con mucho gusto! Aquí sigo para acompañarte en Flow.',
  '¡Qué gusto poder ayudarte! Cuando quieras, seguimos explorando Flow.',
  '¡Cuenta conmigo! ¿Quieres que veamos algo más de Flow?'
 ] },
 { pattern: /^(adios|hasta luego|nos vemos|bye|me voy)$/, emotion: 'special', replies: [
  '¡Hasta pronto! Qué gusto acompañarte. Aquí estaré cuando vuelvas.',
  '¡Nos vemos! Que tengas un lindo día; Chattito te espera por aquí.'
 ] },
 { pattern: /^(quien eres|que eres|como te llamas|que puedes hacer|ayuda)$/, emotion: 'idle', replies: [
  '¡Soy Chattito, tu guía de Flow! Puedo explicar pantallas, llevarte a una, señalar elementos y mostrar recorridos; no veo ni cambio datos. Prueba: «¿Dónde veo mi plan?» o «Enséñame a crear un módulo».',
  '¡Me llamo Chattito y me encanta acompañarte en Flow! Explico pantallas, te llevo a ellas, señalo elementos y muestro recorridos; no veo ni cambio datos. Puedes decir: «¿Dónde veo mi plan?» o «Enséñame a crear un módulo».'
 ] },
 { pattern: /^(eres genial|te quiero|que lindo|que linda|buen trabajo)$/, emotion: 'special', replies: [
  '¡Gracias por ese cariño! Mis antenas se alegran. ¿Seguimos explorando Flow?',
  '¡Qué lindo que me lo digas! Me alegra acompañarte. ¿Te ayudo con algo más de Flow?'
 ] },
 { pattern: /^(cuentame un chiste|dime un chiste|cuentame una curiosidad|dime una curiosidad)$/, emotion: 'idle', replies: [
  'Mis antenas captan mejor pantallas que chistes; ¿te muestro algo curioso de Flow?',
  '¡Mis antenas ya buscan la siguiente aventura! ¿Descubrimos una pantalla de Flow juntos?'
 ] }
] as const
export function courtesyReply(text: string, history: readonly AgentTurn[] = []): AgentReply | null {
 if (text.length > 100) return null
 const message = normalizeAgentMessage(text).replace(/^chattito\s+|\s+chattito$/g, '').trim()
 const family = courtesyFamilies.find(family => family.pattern.test(message))
 return family ? { reply: chooseAgentVariant(family.replies, { message, history }), emotion: family.emotion, actions: [], layer: 'catalog' } : null
}
export const agentFallbacks = {
 offtopic: [
  'Eso se me escapa un poco, lo mío es Flow. Con gusto te llevo a una pantalla o te muestro un recorrido; ¿por dónde empezamos?',
  '¡Vaya tema! No sé ayudarte con eso, pero sí con Flow. ¿Quieres encontrar una pantalla o aprender con un recorrido?',
  'Me encantaría tener una respuesta para eso; por ahora te acompaño en Flow. ¿Te enseño dónde ver tu plan o cómo crear un módulo?',
  'Mis antenas todavía no llegan a ese tema. Sí puedo guiarte en Flow; ¿qué pantalla quieres descubrir?'
 ],
 unavailable: [
  'Mi ayuda con IA no está disponible ahora, pero sigo aquí contigo. ¿Te llevo a una pantalla de Flow o vemos un recorrido?',
  'Ahora mi ayuda con IA necesita una pausa. Con gusto seguimos con las pantallas y recorridos de Flow; ¿qué quieres encontrar?'
 ],
 no_provider: [
  'Todavía no tengo mi ayuda con IA activada, pero sí ganas de acompañarte. ¿Te guío por una pantalla o un recorrido de Flow?',
  'Mi ayuda con IA aún no está configurada. Aquí sigo para mostrarte las pantallas y recorridos de Flow; ¿por dónde empezamos?'
 ],
 busy: [
  'Mi servicio de IA está ocupado ahora. Mientras se libera, ¿te ayudo a encontrar una pantalla o un recorrido de Flow?',
  'Hay bastante trabajo en mi servicio de IA en este momento. Prueba de nuevo en un ratito; mientras tanto, ¿vemos una pantalla de Flow?'
 ],
 quota: [
  'Llegamos al límite de consultas con IA, pero aquí sigo contigo. ¿Te ayudo con las pantallas o recorridos de Flow?',
  'Las consultas con IA alcanzaron su límite por ahora. Podemos seguir explorando Flow juntos; ¿qué pantalla o recorrido quieres ver?'
 ],
 rate: [
  'Dame un momentito para seguir con las consultas con IA. Mientras tanto, con gusto te indico las pantallas de Flow.',
  'Las consultas con IA van muy rápido; en un momento seguimos. Aquí estoy para guiarte por las pantallas y recorridos de Flow.'
 ],
 network: [
  'Ahora no pude conectar para responderte. Prueba de nuevo en un momento; sigo aquí para acompañarte y puedes pedirme un recorrido de Flow.',
  'La conexión no me dejó responder esta vez. Inténtalo en un ratito; mientras tanto, podemos ver un recorrido de Flow juntos.'
 ]
} as const
export function agentFallbackReply(kind: keyof typeof agentFallbacks, context: AgentReplyContext = {}): AgentReply {
 return { reply: chooseAgentVariant(agentFallbacks[kind], context), emotion: 'idle', actions: [], layer: kind === 'offtopic' ? 'offtopic' : kind === 'quota' || kind === 'rate' ? 'limited' : 'unavailable' }
}
export function agentHistory(messages: readonly { role: 'user' | 'assistant'; text: string }[]) {
 return messages.filter(message => message.text.trim()).slice(-8).map(message => ({ role: message.role, text: message.text.slice(0, 700) }))
}
