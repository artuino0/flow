import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentReply } from '../../utils/agentConversation'

vi.mock('../../server/db', () => ({ withTenant: vi.fn(async () => [{ admin: true }]) }))
vi.mock('../../server/utils/agent/usage', () => ({
 readAgentPlan: vi.fn(async () => ({ code: 'escala' })),
 recordAgentMetric: vi.fn(),
 withAgentQuota: vi.fn(async (_auth: unknown, complete: () => Promise<{ reply: AgentReply }>) => (await complete()).reply)
}))
import { resolveAgentMessage } from '../../server/utils/agent/service'
import { agentMaxOutputTokens, agentResilience } from '../../server/utils/agent/resilience'
import { agentFallbacks, courtesyReply } from '../../utils/agentConversation'
import { recordAgentMetric, withAgentQuota } from '../../server/utils/agent/usage'

const auth = { sub: 'test-user', tenantId: 'test-tenant', roleId: 'test-role', sid: 'test-session' }
const input = { message: '¿Cómo organizo el trabajo de mi equipo en Flow?', context: { page: 'home', path: '/' } }
const output = JSON.stringify({ intent: 'guide', reply: 'Organiza el trabajo en Flow.', emotion: 'happy', actions: [] })
const response = (content = output) => new Response(JSON.stringify({ choices: [{ finish_reason: content ? 'stop' : 'length', message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 45 } }))
let logs: ReturnType<typeof vi.spyOn>
beforeEach(() => {
 vi.stubEnv('AI_PROVIDER','openai'); vi.stubEnv('OPENAI_API_KEY','simulated'); vi.stubEnv('OPENAI_MODEL','gpt-6-luna'); vi.stubEnv('AGENT_AI_MAX_OUTPUT_TOKENS',''); vi.stubEnv('AGENT_AI_TIMEOUT_MS','12000')
 agentResilience.active = 0; agentResilience.failures = 0; agentResilience.failureStart = 0; agentResilience.openUntil = 0; agentResilience.probing = false
 vi.spyOn(agentResilience,'rate').mockReturnValue(0)
 logs = vi.spyOn(console,'info').mockImplementation(() => {})
 // Toda prueba bloquea la red incluso si no espera una llamada al proveedor.
 vi.stubGlobal('fetch',vi.fn(() => { throw new Error('Red prohibida') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function log() {
 const serialized = logs.mock.calls.flat().join('')
 expect(serialized).not.toContain(input.message)
 expect(serialized).not.toContain('Organiza el trabajo en Flow.')
 expect(serialized).not.toContain('simulated')
 return JSON.parse(String(logs.mock.calls.at(-1)?.[0]))
}
describe('BUG-ERD-140: servicio y transporte simulados, sin BD ni red', () => {
 it('ERD-141: todas las cortesías evitan proveedor, ráfaga y cuota en servidor', async () => {
  vi.mocked(withAgentQuota).mockClear(); vi.mocked(recordAgentMetric).mockClear()
  const history = [{ role: 'assistant' as const, text: courtesyReply('como estas')!.reply }]
  for (const message of ['como estas', 'hola chattito', 'bien', 'mal', 'cansado', 'mil gracias', 'adiós', 'quién eres', 'eres genial', 'cuéntame un chiste']) {
   expect(await resolveAgentMessage(auth, { ...input, message, history })).toEqual(courtesyReply(message, history))
  }
  expect(fetch).not.toHaveBeenCalled(); expect(agentResilience.rate).not.toHaveBeenCalled(); expect(withAgentQuota).not.toHaveBeenCalled()
  expect(recordAgentMetric).toHaveBeenCalledTimes(10)
 })
 it('ERD-141: charla breve que llega a capa 3 conserva personaje y contrato con proveedor simulado', async () => {
  const reply = '¡Muy bien, gracias por preguntar! ¿Y tú? Con gusto te acompaño en Flow.'
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => response(JSON.stringify({ intent: 'guide', reply, emotion: 'happy', actions: [] }))); vi.stubGlobal('fetch', fetch)
  expect(await resolveAgentMessage(auth, { ...input, message: '¿Cómo estás? ¿Me acompañas hoy en Flow?' })).toMatchObject({ layer: 'ai', reply, emotion: 'happy', actions: [] })
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
  expect(body.messages[0].content).toContain('usa intent guide')
  expect(body.messages[0].content).toContain('sin emojis')
  expect(fetch).toHaveBeenCalledOnce()
 })
 it('ERD-141: respaldo honesto diferencia configuración, ocupación y ráfaga', async () => {
  vi.stubEnv('AI_PROVIDER', '')
  expect(agentFallbacks.no_provider).toContain((await resolveAgentMessage(auth, input)).reply)
  vi.stubEnv('AI_PROVIDER', 'openai'); agentResilience.active = agentResilience.maxConcurrency
  expect(agentFallbacks.busy).toContain((await resolveAgentMessage(auth, input)).reply)
  vi.mocked(agentResilience.rate).mockReturnValue(30)
  expect(await resolveAgentMessage(auth, input)).toMatchObject({ layer: 'limited', retryAfterSec: 30 })
  expect(agentFallbacks.rate).toContain((await resolveAgentMessage(auth, input)).reply)
  expect(fetch).not.toHaveBeenCalled()
 })
 it.each(['','2200','99999'])('envía presupuesto configurable %s sin temperature', async configured => {
  vi.stubEnv('AGENT_AI_MAX_OUTPUT_TOKENS',configured)
  const fetch = vi.fn(async (_url: unknown,_init: RequestInit) => response()); vi.stubGlobal('fetch',fetch)
  expect((await resolveAgentMessage(auth,input)).layer).toBe('ai')
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
  expect(body.max_completion_tokens).toBe(configured === '' ? 1500 : configured === '2200' ? 2200 : 4096)
  expect(body).not.toHaveProperty('temperature'); expect(fetch).toHaveBeenCalledOnce(); log()
 })
 it.each(['bad','0','-1','Infinity'])('presupuesto inválido %s usa 1500', configured => {
  vi.stubEnv('AGENT_AI_MAX_OUTPUT_TOKENS',configured); expect(agentMaxOutputTokens()).toBe(1500)
 })
 it.each([400,401,403,404,422])('HTTP %s no se reintenta ni abre el circuito', async status => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unsupported_value', message: input.message } }),{ status })); vi.stubGlobal('fetch',fetch)
  for (let attempt = 0; attempt < 4; attempt++) {
   expect((await resolveAgentMessage(auth,input)).layer).toBe('unavailable')
   expect(log()).toMatchObject({ layer: 'unavailable', reason: `provider_http_${status}`, code: 'unsupported_value' })
  }
  expect(fetch).toHaveBeenCalledTimes(4); expect(agentResilience.openUntil).toBe(0); expect(agentResilience.failures).toBe(0); expect(agentResilience.active).toBe(0)
 })
 it('no registra códigos con texto libre ni el cuerpo del error', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({ error: { code: input.message, message: input.message } }),{ status: 400 })))
  await resolveAgentMessage(auth,input); expect(log()).not.toHaveProperty('code')
 })
 it('contenido vacío por finish_reason length registra empty_output y los tokens', async () => {
  const fetch = vi.fn(async () => response('')); vi.stubGlobal('fetch',fetch)
  expect((await resolveAgentMessage(auth,input)).layer).toBe('unavailable')
  expect(log()).toMatchObject({ reason: 'empty_output', tokensIn: 20, tokensOut: 45 }); expect(fetch).toHaveBeenCalledOnce(); expect(agentResilience.failures).toBe(0)
 })
 it('JSON de transporte inválido registra invalid_json sin reintento', async () => {
  const fetch = vi.fn(async () => new Response(input.message)); vi.stubGlobal('fetch',fetch)
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('invalid_json'); expect(fetch).toHaveBeenCalledOnce(); expect(agentResilience.failures).toBe(0)
 })
 it('Anthropic conserva presupuesto y reporta fallos de forma segura', async () => {
  vi.stubEnv('AI_PROVIDER','anthropic'); vi.stubEnv('ANTHROPIC_API_KEY','simulated')
  const fetch = vi.fn(async (_url: unknown,_init: RequestInit) => new Response(JSON.stringify({ content: [{ type: 'text', text: output }], usage: { input_tokens: 20, output_tokens: 45 } }))); vi.stubGlobal('fetch',fetch)
  expect((await resolveAgentMessage(auth,input)).layer).toBe('ai'); expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).max_tokens).toBe(1500); log()
  vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_request', message: input.message } }),{ status: 400 })))
  await resolveAgentMessage(auth,input); expect(log()).toMatchObject({ reason: 'provider_http_400', code: 'invalid_request' }); expect(agentResilience.failures).toBe(0)
 })
 it.each(['invalid',JSON.stringify({ intent: 'guide', reply: 'x'.repeat(701), emotion: 'idle', actions: [] })])('JSON inválido o respuesta larga conservan la validación', async content => {
  vi.stubGlobal('fetch',vi.fn(async () => response(content)))
  expect((await resolveAgentMessage(auth,input)).layer).toBe('unavailable'); expect(log().reason).toBe('invalid_json'); expect(agentResilience.failures).toBe(0)
 })
 it.each([408,429,503])('HTTP %s reintenta una vez y abre el circuito tras tres fallos', async status => {
  const fetch = vi.fn(async () => new Response('{}',{ status })); vi.stubGlobal('fetch',fetch)
  for (let i = 0; i < 3; i++) { await resolveAgentMessage(auth,input); expect(log().reason).toBe(`provider_http_${status}`) }
  expect(fetch).toHaveBeenCalledTimes(6); expect(agentResilience.openUntil).toBeGreaterThan(Date.now())
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('circuit_open'); expect(fetch).toHaveBeenCalledTimes(6)
 })
 it('un transitorio recuperado responde y reinicia fallos', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}',{ status: 503 })).mockResolvedValueOnce(response()); vi.stubGlobal('fetch',fetch)
  agentResilience.failures = 2
  expect((await resolveAgentMessage(auth,input)).layer).toBe('ai'); expect(fetch).toHaveBeenCalledTimes(2); expect(agentResilience.failures).toBe(0); log()
 })
 it('timeout registra motivo seguro y cuenta para circuito', async () => {
  vi.stubEnv('AGENT_AI_TIMEOUT_MS','10')
  vi.stubGlobal('fetch',vi.fn((_url: unknown,init: RequestInit) => new Promise((_resolve,reject) => init.signal!.addEventListener('abort',() => reject(new Error(input.message)),{ once: true }))))
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('timeout'); expect(agentResilience.failures).toBe(1); expect(agentResilience.active).toBe(0)
 })
 it('fallo de red transitorio se reintenta sin registrar el mensaje del error', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError(input.message)); vi.stubGlobal('fetch',fetch)
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('network_error'); expect(fetch).toHaveBeenCalledTimes(2); expect(agentResilience.failures).toBe(1)
 })
 it('sin proveedor y concurrencia agotada registran no_provider y busy', async () => {
  vi.stubEnv('AI_PROVIDER',''); await resolveAgentMessage(auth,input); expect(log().reason).toBe('no_provider')
  vi.stubEnv('AI_PROVIDER','openai'); agentResilience.active = agentResilience.maxConcurrency
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('busy'); expect(fetch).not.toHaveBeenCalled()
 })
})
