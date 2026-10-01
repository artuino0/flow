import { AiCompletionError, completeJson, type AiCompletionParams } from '../aiProvider'
import { AgentResilience, agentResilience, agentMaxOutputTokens, agentTimeoutMs } from './resilience'
import { agentComplexity, agentModelChain, agentModelTokenBudget, configuredAgentModels } from './modelPolicy'

type Complete = (params: AiCompletionParams) => Promise<string>
export class AgentModelPool {
 private circuits = new Map<string, AgentResilience>()
 private unavailable = new Map<string, number>()
 private checkedAt: number | undefined
 private checking = false
 private circuit(model: string) {
  let circuit = this.circuits.get(model)
  if (!circuit) {
   circuit = new AgentResilience(agentResilience.maxConcurrency, agentResilience.perMinute, agentResilience.failureThreshold, agentResilience.windowMs, agentResilience.openMs)
   this.circuits.set(model, circuit)
  }
  return circuit
 }
 reset() { this.circuits.clear(); this.unavailable.clear(); this.checkedAt = undefined; this.checking = false }
 allUnavailable(now = Date.now()) {
  return agentModelChain('light').every(model => (this.unavailable.get(model) || 0) > now || (this.circuits.get(model)?.openUntil || 0) > now)
 }
 async complete(input: { message: string; history?: readonly { text: string }[] }, params: AiCompletionParams, complete: Complete = completeJson, onAttempt?: (model: string | undefined, fallbackCount: number) => void) {
  // Anthropic conserva su proveedor/modelo previo y no recibe nombres OpenAI.
  const chain = process.env.AI_PROVIDER === 'anthropic' ? [process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5'] : agentModelChain(agentComplexity(input))
  const deadline = Date.now() + (params.timeoutMs ?? agentTimeoutMs())
  let last: unknown = new AiCompletionError('circuit_open', true)
  let fallbackCount = 0
  let lastModel: string | undefined
  for (const model of chain) {
   if (Date.now() >= deadline) throw last
   const circuit = this.circuit(model)
   if ((this.unavailable.get(model) || 0) > Date.now() || !circuit.enter()) { fallbackCount++; onAttempt?.(lastModel, fallbackCount); continue }
   lastModel = model; onAttempt?.(model, fallbackCount)
   let success: boolean | null = null
   try {
    for (let attempt = 0; ; attempt++) {
     try {
      const raw = await complete({ ...params, model, structured: true, maxTokens: agentModelTokenBudget(model, params.maxTokens ?? agentMaxOutputTokens()), timeoutMs: Math.max(1, deadline - Date.now()) })
      success = true
      return { raw, model, fallbackCount }
     } catch (error) {
      last = error
      if (!(error instanceof AiCompletionError && error.transient) || attempt >= 1 || Date.now() >= deadline) throw error
     }
    }
   } catch (error) {
    if (!(error instanceof AiCompletionError)) throw error
    success = error.transient ? false : null
    const modelMissing = process.env.AI_PROVIDER !== 'anthropic' && (error.code === 'model_not_found' || error.reason === 'provider_http_404' || error.modelUnavailable)
    if (modelMissing) this.unavailable.set(model, Date.now() + circuit.openMs)
    // Solo salta por modelo inexistente/no soportado o al agotar su circuito.
    const failures = Date.now() - circuit.failureStart > circuit.windowMs ? 1 : circuit.failures + 1
    if (!modelMissing && !(error.transient && failures >= circuit.failureThreshold)) throw error
    fallbackCount++
   } finally { circuit.leave(success) }
  }
  throw last
 }
 /** Retorna de inmediato; como máximo una ronda cada seis horas por proceso. */
 watch(complete: Complete = completeJson, now = Date.now()) {
  if (process.env.AI_PROVIDER !== 'openai' || !process.env.OPENAI_API_KEY || this.checking || (this.checkedAt !== undefined && now - this.checkedAt < 6 * 60 * 60 * 1000)) return
  this.checkedAt = now; this.checking = true
  const models = [...new Set(Object.values(configuredAgentModels()))]
  void (async () => {
   try {
    for (const model of models) {
     // La sonda también respeta la concurrencia global y el circuito del agente.
     if (!agentResilience.enter()) continue
     try {
      await complete({ model, system: 'Devuelve JSON.', prompt: '{"ok":true}', structured: true, maxTokens: 1, timeoutMs: Math.min(3000, agentTimeoutMs()) })
      this.unavailable.delete(model)
     } catch (error) {
      // Un presupuesto mínimo puede acabar sin texto: la API sí reconoció el modelo.
      if (error instanceof AiCompletionError && error.reason === 'empty_output') { this.unavailable.delete(model); continue }
      console.warn(JSON.stringify({ event: 'agent_model_unavailable', model }))
      // Ausencia confirmada: seis horas. Fallos temporales: apertura breve y luego reintento.
      const missing = error instanceof AiCompletionError && (error.code === 'model_not_found' || error.reason === 'provider_http_404' || error.modelUnavailable)
      this.unavailable.set(model, Date.now() + (missing ? 6 * 60 * 60 * 1000 : agentResilience.openMs))
     } finally { agentResilience.leave(null) }
    }
   } finally { this.checking = false }
  })()
 }
}
export const agentModelPool = new AgentModelPool()
