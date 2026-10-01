import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentComplexity, agentModelChain, agentModelTokenBudget, configuredAgentModels } from '../../server/utils/agent/modelPolicy'
import { AgentModelPool } from '../../server/utils/agent/models'
import { AiCompletionError, completeJson, type AiCompletionParams } from '../../server/utils/aiProvider'
import { agentResilience } from '../../server/utils/agent/resilience'

const input = { message: '¿Cómo organizo el trabajo en Flow?' }
const params = { system: 'Reglas', prompt: 'MENSAJE PRIVADO', timeoutMs: 1000 }
beforeEach(() => {
 vi.stubEnv('AI_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', 'CLAVE PRIVADA')
 for (const key of ['AGENT_AI_MODEL', 'AGENT_AI_MODEL_FALLBACK', 'AGENT_AI_MODEL_HIGH']) vi.stubEnv(key, '')
 agentResilience.active = 0; agentResilience.openUntil = 0; agentResilience.probing = false
 vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Red prohibida') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('ERD-142 política determinista', () => {
 it.each(['Hola', '¿Cómo creo un servicio?', 'Abre cuentas por cobrar', input.message])('ligero: %s', message => expect(agentComplexity({ message })).toBe('light'))
 it.each(['x'.repeat(350), '¿Cómo empiezo? ¿Dónde continúo?', 'como creo un servicio y donde veo su precio', 'Compara módulos y catálogos', 'Analiza las ventajas y desventajas', '¿Cuáles son las diferencias?'])('alto: %s', message => expect(agentComplexity({ message })).toBe('high'))
 it('historial largo por turnos o caracteres, sin modificar entrada', () => {
  const history = Array.from({ length: 6 }, () => ({ text: 'dato' }))
  expect(agentComplexity({ ...input, history })).toBe('high')
  expect(agentComplexity({ ...input, history: [{ text: 'x'.repeat(1800) }] })).toBe('high')
  expect(history).toHaveLength(6)
 })
 it('defaults, independencia de OPENAI_MODEL y cadena sin duplicados', () => {
  expect(configuredAgentModels({ OPENAI_MODEL: 'otro' })).toEqual({ light: 'gpt-5.4-mini', fallback: 'gpt-5.4-nano', high: 'gpt-6-luna' })
  expect(agentModelChain('high')).toEqual(['gpt-6-luna', 'gpt-5.4-mini', 'gpt-5.4-nano'])
  expect(agentModelChain('light', { light: 'x', fallback: 'x', high: 'y' })).toEqual(['x', 'y'])
  expect(configuredAgentModels({ AGENT_AI_MODEL: '  custom  ' }).light).toBe('custom')
 })
 it('presupuesto por modelo y sin temperature con transporte simulado', async () => {
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })))
  vi.stubGlobal('fetch', fetch)
  for (const model of agentModelChain('light')) {
   await completeJson({ ...params, model, structured: true, maxTokens: agentModelTokenBudget(model, 1500) })
   const body = JSON.parse(String(fetch.mock.calls.at(-1)?.[1].body))
   expect(body.max_completion_tokens).toBe(model === 'gpt-6-luna' ? 3000 : 1500)
   expect(body).not.toHaveProperty('temperature'); expect(body).not.toHaveProperty('max_tokens')
  }
 })
})
describe('ERD-142 respaldo y circuitos por modelo, sin red', () => {
 it.each([new AiCompletionError('provider_http_404'), new AiCompletionError('provider_http_400', false, 'model_not_found'), new AiCompletionError('provider_http_400', false, 'unsupported_model', true)])('salta al respaldo por %s', async error => {
  const pool = new AgentModelPool()
  const complete = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('{}')
  expect(await pool.complete(input, params, complete)).toMatchObject({ model: 'gpt-5.4-nano', fallbackCount: 1 })
  expect(complete.mock.calls.map(call => call[0].model)).toEqual(['gpt-5.4-mini', 'gpt-5.4-nano'])
  expect((await pool.complete(input, params, complete)).model).toBe('gpt-5.4-nano')
 })
 it('400 por parámetro model activa respaldo; 400 por otra causa conserva rechazo', async () => {
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
   const model = JSON.parse(String(init.body)).model
   return model === 'gpt-5.4-mini' ? new Response(JSON.stringify({ error: { code: 'unsupported_value', param: 'model', message: 'PRIVADO' } }), { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
  }); vi.stubGlobal('fetch', fetch)
  expect((await new AgentModelPool().complete(input, params)).model).toBe('gpt-5.4-nano')
  const fail = vi.fn().mockRejectedValue(new AiCompletionError('provider_http_400', false, 'unsupported_value'))
  await expect(new AgentModelPool().complete(input, params, fail)).rejects.toThrow('provider_http_400'); expect(fail).toHaveBeenCalledOnce()
 })
 it('agota el circuito del ligero y usa nano; evita ligero durante apertura', async () => {
  const pool = new AgentModelPool()
  const complete = vi.fn(async (request: AiCompletionParams) => { if (request.model === 'gpt-5.4-mini') throw new AiCompletionError('provider_http_503', true); return '{}' })
  for (let i = 0; i < 2; i++) await expect(pool.complete(input, params, complete)).rejects.toThrow('provider_http_503')
  expect(await pool.complete(input, params, complete)).toMatchObject({ model: 'gpt-5.4-nano', fallbackCount: 1 })
  expect(complete).toHaveBeenCalledTimes(7)
  expect((await pool.complete(input, params, complete)).model).toBe('gpt-5.4-nano'); expect(complete).toHaveBeenCalledTimes(8)
 })
 it('todos ausentes, sin reintentos infinitos; alta complejidad empieza por Luna', async () => {
  const pool = new AgentModelPool(); const fail = vi.fn().mockRejectedValue(new AiCompletionError('provider_http_404'))
  await expect(pool.complete({ message: 'Compara alternativas' }, params, fail)).rejects.toThrow('provider_http_404')
  expect(fail.mock.calls.map(call => call[0].model)).toEqual(['gpt-6-luna', 'gpt-5.4-mini', 'gpt-5.4-nano'])
  expect(pool.allUnavailable()).toBe(true)
  await expect(pool.complete(input, params, fail)).rejects.toThrow('circuit_open'); expect(fail).toHaveBeenCalledTimes(3)
 })
 it('el plazo total se comparte y los circuitos vuelven a sondear tras vencer', async () => {
  vi.useFakeTimers()
  try {
   const pool = new AgentModelPool(); const fail = vi.fn().mockRejectedValue(new AiCompletionError('provider_http_404'))
   await expect(pool.complete(input, params, fail)).rejects.toThrow()
   vi.advanceTimersByTime(agentResilience.openMs + 1)
   const ok = vi.fn(async () => '{}')
   expect((await pool.complete(input, params, ok)).model).toBe('gpt-5.4-mini')
   const slow = vi.fn(async () => { vi.advanceTimersByTime(1000); throw new AiCompletionError('provider_http_404') })
   await expect(new AgentModelPool().complete(input, params, slow)).rejects.toThrow(); expect(slow).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
 })
})
describe('ERD-142 vigilancia no bloqueante', () => {
 it('retorna antes de completar, limita seis horas y avisa sin contenido privado', async () => {
  const pool = new AgentModelPool(); let finish!: (value: string) => void
  const complete = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve })).mockRejectedValue(new AiCompletionError('provider_http_404'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(pool.watch(complete, 0)).toBeUndefined(); expect(complete).toHaveBeenCalledOnce()
  pool.watch(complete, 1); finish('{}')
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
  pool.watch(complete, 1000); expect(complete).toHaveBeenCalledTimes(3)
  expect(warn.mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([{ event: 'agent_model_unavailable', model: 'gpt-5.4-nano' }, { event: 'agent_model_unavailable', model: 'gpt-6-luna' }])
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PRIVAD|MENSAJE|CLAVE/)
  expect(agentResilience.active).toBe(0)
  pool.watch(complete, 6 * 60 * 60 * 1000)
  await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(6))
 })
 it('sonda sin salida confirma existencia; modelo ausente degrada a respaldo', async () => {
  const pool = new AgentModelPool(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const probe = vi.fn().mockRejectedValueOnce(new AiCompletionError('provider_http_404')).mockRejectedValue(new AiCompletionError('empty_output'))
  pool.watch(probe)
  await vi.waitFor(() => expect(agentResilience.active).toBe(0))
  expect(warn).toHaveBeenCalledOnce()
  expect((await pool.complete(input, params, vi.fn(async () => '{}'))).model).toBe('gpt-5.4-nano')
 })
 it('sin clave, ocupado o circuito global abierto no inicia llamadas', () => {
  const probe = vi.fn(); vi.stubEnv('OPENAI_API_KEY', '')
  new AgentModelPool().watch(probe); expect(probe).not.toHaveBeenCalled()
  vi.stubEnv('OPENAI_API_KEY', 'test'); agentResilience.active = agentResilience.maxConcurrency
  new AgentModelPool().watch(probe); expect(probe).not.toHaveBeenCalled()
  agentResilience.active = 0; agentResilience.openUntil = Date.now() + 60000
  new AgentModelPool().watch(probe); expect(probe).not.toHaveBeenCalled()
 })
})
