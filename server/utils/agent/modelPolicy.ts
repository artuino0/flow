export interface AgentModels { light: string; fallback: string; high: string }
export function configuredAgentModels(env: Record<string, string | undefined> = process.env): AgentModels {
 return { light: env.AGENT_AI_MODEL?.trim() || 'gpt-5.4-mini', fallback: env.AGENT_AI_MODEL_FALLBACK?.trim() || 'gpt-5.4-nano', high: env.AGENT_AI_MODEL_HIGH?.trim() || 'gpt-6-luna' }
}
export function agentComplexity(input: { message: string; history?: readonly { text: string }[] }): 'light' | 'high' {
 const text = input.message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
 const history = input.history || []
 return text.length >= 350 || (text.match(/\?/g)?.length || 0) >= 2 ||
  ((text.match(/\b(como|donde|cuando|cual|cuales|por que)\b/g)?.length || 0) >= 2 && /\by\b|\?/.test(text)) ||
  /\b(compara\w*|comparacion|analiza\w*|analisis|ventajas|desventajas|diferencias?|pros y contras)\b/.test(text) ||
  history.length >= 6 || history.reduce((sum, turn) => sum + turn.text.length, 0) >= 1800 ? 'high' : 'light'
}
export function agentModelChain(complexity: 'light' | 'high', models = configuredAgentModels()) {
 return [...new Set(complexity === 'high' ? [models.high, models.light, models.fallback] : [models.light, models.fallback, models.high])]
}
export function agentModelTokenBudget(model: string, base: number) {
 // Los modelos con razonamiento comparten presupuesto entre razonamiento y salida.
 return /^(gpt-6|gpt-5(?!\.4-(?:mini|nano))|o[134])/.test(model) ? Math.max(base, 3000) : base
}
