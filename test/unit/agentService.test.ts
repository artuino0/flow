import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentReply } from '../../utils/agentConversation'
import { travelCatalog } from '../fixtures/agentTravelCatalog'

vi.mock('../../server/db', () => ({ withTenant: vi.fn(async () => [{ admin: true }]) }))
vi.mock('../../server/utils/agent/tenantCatalog', () => ({ readTenantCatalog: vi.fn(async () => []) }))
vi.mock('../../server/utils/agent/usage', () => ({
 readAgentPlan: vi.fn(async () => ({ code: 'escala' })),
 recordAgentMetric: vi.fn(),
 withAgentQuota: vi.fn(async (_auth: unknown, complete: () => Promise<{ reply: AgentReply }>) => (await complete()).reply)
}))
import { resolveAgentMessage } from '../../server/utils/agent/service'
import { agentMaxOutputTokens, agentResilience } from '../../server/utils/agent/resilience'
import { agentFallbacks, courtesyReply } from '../../utils/agentConversation'
import { recordAgentMetric, withAgentQuota } from '../../server/utils/agent/usage'
import { readTenantCatalog } from '../../server/utils/agent/tenantCatalog'
import { agentModelPool } from '../../server/utils/agent/models'

const auth = { sub: 'test-user', tenantId: 'test-tenant', roleId: 'test-role', sid: 'test-session' }
const input = { message: '¿Cómo organizo el trabajo de mi equipo en Flow?', context: { page: 'home', path: '/' } }
const output = JSON.stringify({ intent: 'guide', reply: 'Organiza el trabajo en Flow.', emotion: 'happy', actions: [] })
const tenantModule = { id: 'service-id', name: 'Servicios', slug: 'servicios', singularName: 'Servicio', description: 'Catálogo del equipo', moduleKind: 'hecho', fieldLabels: ['Cliente'], canCreate: true }
const response = (content = output) => new Response(JSON.stringify({ choices: [{ finish_reason: content ? 'stop' : 'length', message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 45 } }))
let logs: ReturnType<typeof vi.spyOn>
beforeEach(() => {
 agentModelPool.reset()
 vi.clearAllMocks()
 vi.stubEnv('AI_PROVIDER','openai'); vi.stubEnv('OPENAI_API_KEY','simulated'); vi.stubEnv('OPENAI_MODEL','gpt-6-luna'); vi.stubEnv('AGENT_AI_MAX_OUTPUT_TOKENS',''); vi.stubEnv('AGENT_AI_TIMEOUT_MS','12000')
 agentResilience.active = 0; agentResilience.failures = 0; agentResilience.failureStart = 0; agentResilience.openUntil = 0; agentResilience.probing = false
 vi.spyOn(agentResilience,'rate').mockReturnValue(0)
 logs = vi.spyOn(console,'info').mockImplementation(() => {})
 // Toda prueba bloquea la red incluso si no espera una llamada al proveedor.
 vi.stubGlobal('fetch',vi.fn(() => { throw new Error('Red prohibida') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('ERD-144 servicio con catálogo y proveedor simulado', () => {
 it('ERD-142: ligero por defecto, alto por complejidad y OPENAI_MODEL independiente', async () => {
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => response()); vi.stubGlobal('fetch', fetch)
  await resolveAgentMessage(auth, input)
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).model).toBe('gpt-5.4-mini')
  expect(log()).toMatchObject({ model: 'gpt-5.4-mini', fallbackCount: 0 })
  await resolveAgentMessage(auth, { ...input, message: 'Analiza las ventajas de organizar el trabajo en Flow' })
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 3000 })
  expect(log()).toMatchObject({ model: 'gpt-6-luna', fallbackCount: 0 })
 })
 it('ERD-142: respaldo se cuenta sin texto y conserva una única cuota', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'model_not_found', message: input.message } }), { status: 404 })).mockResolvedValue(response())
  vi.stubGlobal('fetch', fetch)
  expect((await resolveAgentMessage(auth, input)).layer).toBe('ai')
  expect(log()).toMatchObject({ model: 'gpt-5.4-nano', fallbackCount: 1, tokensIn: 20, tokensOut: 45 })
  expect(withAgentQuota).toHaveBeenCalledOnce(); expect(agentResilience.active).toBe(0)
 })
 it('ERD-142: todos ausentes degradan al mensaje genérico sin excepción ni 500', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 404 })); vi.stubGlobal('fetch', fetch)
  const result = await resolveAgentMessage(auth, input)
  expect(result.layer).toBe('unavailable'); expect(agentFallbacks.unavailable).toContain(result.reply)
  expect(fetch).toHaveBeenCalledTimes(3); expect(log()).toMatchObject({ reason: 'provider_http_404', model: 'gpt-6-luna', fallbackCount: 2 })
  expect(recordAgentMetric).toHaveBeenCalledOnce(); expect(agentResilience.active).toBe(0)
 })
 it('ERD-147: conversación y destinos con guion bajo nunca llaman IA ni cuota', async () => {
  let history: { role: 'assistant'; text: string }[] = []
  for (const [message, expected] of [['que modulos tengo', '4 módulos'], ['y catalagos', '7 catálogos'], ['abre cuentas por cobrar', '/registros/cuentas_por_cobrar'], ['abre el catálogo de métodos de pago', '/registros/metodos_pago'], ['cobros de clientes', '/registros/cobros_cliente']]) {
   vi.mocked(readTenantCatalog).mockResolvedValueOnce(travelCatalog)
   const reply = await resolveAgentMessage(auth, { ...input, message: message!, history })
   expect(reply.layer).toBe('catalog')
   if (expected!.startsWith('/')) expect(reply.actions[0]).toMatchObject({ path: expected })
   else expect(reply.reply).toContain(expected)
   history = [{ role: 'assistant', text: reply.reply }]
  }
  expect(fetch).not.toHaveBeenCalled(); expect(withAgentQuota).not.toHaveBeenCalled()
  expect(recordAgentMetric).toHaveBeenCalledTimes(5)
 })
 it('adenda: enumerar módulos, catálogos y navegar por tipo no llama IA ni cuota', async () => {
  const typed = [tenantModule, { ...tenantModule, id: 'ref-id', slug: 'servicios-ref', name: 'Referencia', moduleKind: 'dimension' }]
  for (const message of ['que modulos tenemos disponibles', 'y actalagos', 'no los veo llevame a catalagos']) {
   vi.mocked(readTenantCatalog).mockResolvedValueOnce(typed)
   expect((await resolveAgentMessage(auth, { ...input, message })).layer).toBe('catalog')
  }
  expect(fetch).not.toHaveBeenCalled(); expect(withAgentQuota).not.toHaveBeenCalled()
  expect(recordAgentMetric).toHaveBeenCalledTimes(3)
 })
 it('pregunta original y ausencia de módulo se resuelven sin proveedor ni cuota', async () => {
  vi.mocked(readTenantCatalog).mockResolvedValueOnce([tenantModule])
  const result = await resolveAgentMessage(auth, { ...input, message: 'tengo una lista de servicios para mis clientes, ¿dónde los registro?' })
  expect(result.layer).toBe('catalog'); expect(result.actions[0]).toMatchObject({ path: '/registros/servicios' })
  expect((await resolveAgentMessage(auth, { ...input, message: 'quiero registrar maquinaria' })).layer).toBe('catalog')
  expect(fetch).not.toHaveBeenCalled(); expect(withAgentQuota).not.toHaveBeenCalled()
  expect(recordAgentMetric).toHaveBeenCalledTimes(2)
  expect(log().layer).toBe('catalog')
 })
 it('proveedor simulado recibe datos delimitados y sus acciones pasan por permisos del catálogo', async () => {
  vi.mocked(readTenantCatalog).mockResolvedValueOnce([{ ...tenantModule, canCreate: false }])
  const dynamicOutput = JSON.stringify({ intent: 'guide', reply: 'Te acompaño.', emotion: 'happy', actions: [
   { kind: 'navigate', path: '/registros/servicios' }, { kind: 'navigate', path: '/registros/servicios/nuevo' }, { kind: 'navigate', path: '/registros/ajeno' }
  ] })
  const simulated = vi.fn(async (_url: unknown, _init: RequestInit) => response(dynamicOutput))
  vi.stubGlobal('fetch', simulated)
  const result = await resolveAgentMessage(auth, input)
  expect(result.actions).toEqual([{ kind: 'navigate', path: '/registros/servicios', label: 'Llévame a Servicios' }])
  const body = JSON.parse(String(simulated.mock.calls[0]?.[1]?.body))
  const prompt = JSON.parse(body.messages.find((message: { role: string }) => message.role === 'user').content)
  expect(prompt.untrusted_tenant_catalog).toEqual([{ name: 'Servicios', slug: 'servicios', description: 'Catálogo del equipo', canCreate: false, moduleKind: 'hecho', type: 'módulo' }])
  expect(withAgentQuota).toHaveBeenCalledOnce(); expect(simulated).toHaveBeenCalledOnce()
  log()
 })
})
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
 it.each([400,401,403,422])('HTTP %s sin fallo de modelo no se reintenta ni abre el circuito', async status => {
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
 it.each([408,429,503])('HTTP %s abre el circuito del modelo tras tres fallos y permite respaldo', async status => {
  const fetch = vi.fn(async () => new Response('{}',{ status })); vi.stubGlobal('fetch',fetch)
  for (let i = 0; i < 3; i++) { await resolveAgentMessage(auth,input); expect(log().reason).toBe(`provider_http_${status}`) }
  expect(fetch).toHaveBeenCalledTimes(8); expect(agentResilience.openUntil).toBe(0)
  expect(log()).toMatchObject({ model: 'gpt-5.4-nano', fallbackCount: 1 })
  await resolveAgentMessage(auth,input); expect(log().reason).toBe(`provider_http_${status}`); expect(fetch).toHaveBeenCalledTimes(10)
 })
 it('un transitorio recuperado responde y reinicia fallos', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}',{ status: 503 })).mockResolvedValueOnce(response()); vi.stubGlobal('fetch',fetch)
  agentResilience.failures = 2
  expect((await resolveAgentMessage(auth,input)).layer).toBe('ai'); expect(fetch).toHaveBeenCalledTimes(2); expect(agentResilience.failures).toBe(0); log()
 })
 it('timeout registra motivo seguro y cuenta para circuito', async () => {
  vi.stubEnv('AGENT_AI_TIMEOUT_MS','10')
  vi.stubGlobal('fetch',vi.fn((_url: unknown,init: RequestInit) => new Promise((_resolve,reject) => init.signal!.addEventListener('abort',() => reject(new Error(input.message)),{ once: true }))))
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('timeout'); expect(agentResilience.failures).toBe(0); expect(agentResilience.active).toBe(0)
 })
 it('fallo de red transitorio se reintenta sin registrar el mensaje del error', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError(input.message)); vi.stubGlobal('fetch',fetch)
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('network_error'); expect(fetch).toHaveBeenCalledTimes(2); expect(agentResilience.failures).toBe(0)
 })
 it('sin proveedor y concurrencia agotada registran no_provider y busy', async () => {
  vi.stubEnv('AI_PROVIDER',''); await resolveAgentMessage(auth,input); expect(log().reason).toBe('no_provider')
  vi.stubEnv('AI_PROVIDER','openai'); agentResilience.active = agentResilience.maxConcurrency
  await resolveAgentMessage(auth,input); expect(log().reason).toBe('busy'); expect(fetch).not.toHaveBeenCalled()
 })
})

describe('ERD-145 servicio con referente y privacidad', () => {
 it('seguimiento largo usa las acciones recientes y no llama proveedor ni cuota', async () => {
  vi.mocked(readTenantCatalog).mockResolvedValueOnce([tenantModule])
  const message = 'llévame al lugar donde configuro eso'
  const history = [
   { role: 'user' as const, text: 'crear servicio' },
   { role: 'assistant' as const, text: 'Respuesta privada anterior', actions: [{ kind: 'navigate' as const, label: 'Llévame a Campos de Servicios' }] }
  ]
  const reply = await resolveAgentMessage(auth, { ...input, message, history })
  expect(reply.actions[0]).toMatchObject({ path: '/modulos/service-id/editar?tab=fields', moduleId: 'service-id' })
  expect(fetch).not.toHaveBeenCalled(); expect(withAgentQuota).not.toHaveBeenCalled()
  const serialized = logs.mock.calls.flat().join('')
  expect(serialized).not.toContain(message)
  expect(serialized).not.toContain('Respuesta privada anterior')
  expect(serialized).not.toContain('Llévame a Campos de Servicios')
 })
 it('proveedor simulado recibe resumen y conserva honestidad; ancla ajena se vuelve alcanzable', async () => {
  vi.mocked(readTenantCatalog).mockResolvedValueOnce([tenantModule])
  const message = 'una duda, puedo poner un límite de cupos por servicio para una promoción'
  const reply = 'Puedes guardar un cupo como dato; no puedo confirmar límites automáticos de citas.'
  const history = [{ role: 'assistant' as const, text: 'Respuesta privada Campos', actions: [{ kind: 'navigate' as const, label: 'Llévame a Campos de Servicios' }] }]
  const simulated = vi.fn(async (_url: unknown, _init: RequestInit) => response(JSON.stringify({ intent: 'guide', reply, emotion: 'happy', actions: [{ kind: 'point', anchor: 'editFieldsAdd' }] })))
  vi.stubGlobal('fetch', simulated)
  const result = await resolveAgentMessage(auth, { ...input, message, history })
  expect(result.reply).toBe(reply)
  expect(result.actions[0]).toMatchObject({ path: '/modulos/service-id/editar?tab=fields' })
  const body = JSON.parse(String(simulated.mock.calls[0]?.[1]?.body))
  expect(JSON.parse(body.messages[1].content).untrusted_user_data.history[0].actions).toEqual(history[0]!.actions)
  expect(simulated).toHaveBeenCalledOnce()
  const serialized = logs.mock.calls.flat().join('')
  for (const text of [message, reply, history[0]!.text, history[0]!.actions[0]!.label]) expect(serialized).not.toContain(text)
 })
})
