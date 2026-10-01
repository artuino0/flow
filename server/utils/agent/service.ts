import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { roles } from '~/server/db/schema'
import { AiCompletionError, AiProviderNotConfiguredError, completeJson } from '~/server/utils/aiProvider'
import { showDesignerAccess } from '~/utils/onboardingTours'
import type { AuthTokenPayload } from '~/server/utils/auth'
import type { AgentReply } from '~/utils/agentConversation'
import { agentPrompt, cheapAgentReply, parseAgentOutput, unavailableReply, type AgentInput } from './layers'
import { agentMaxOutputTokens, agentResilience, agentTimeoutMs } from './resilience'
import { recordAgentMetric, withAgentQuota, readAgentPlan } from './usage'
export async function resolveAgentMessage(auth: AuthTokenPayload, input: AgentInput): Promise<AgentReply> {
 const started = Date.now()
 const [role] = await withTenant(auth.tenantId, tx => tx.select({ admin: roles.isSystem }).from(roles).where(and(eq(roles.id,auth.roleId!),eq(roles.tenantId,auth.tenantId))).limit(1))
 const plan = await readAgentPlan(auth.tenantId)
 const access = { isAdmin: role?.admin === true, designerAvailable: showDesignerAccess(plan.code) }
 let reply = cheapAgentReply(input,access)
 let counted = false
 let tokensIn = 0; let tokensOut = 0
 let reason: string | undefined; let code: string | undefined
 if (!reply) {
  const retry = agentResilience.rate(`${auth.tenantId}:${auth.sub}`) || agentResilience.rate(`tenant:${auth.tenantId}`)
  if (retry) reply = { reply: 'Vamos un poco más despacio. En un momento podemos continuar; también puedo indicarte las pantallas de Flow.', emotion: 'idle', actions: [], layer: 'limited', retryAfterSec: retry }
  else if (!process.env.AI_PROVIDER || !(process.env.AI_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.AI_PROVIDER === 'anthropic' ? process.env.ANTHROPIC_API_KEY : false)) { reason = 'no_provider'; reply = { ...unavailableReply(), reply: 'Todavía no tengo mi cerebro de IA activado. Sí puedo guiarte por las pantallas y recorridos de Flow.' } }
  else if (!agentResilience.enter()) { reason = agentResilience.unavailableReason(); reply = unavailableReply() }
  else {
   let success: boolean | null = null
   try {
    reply = await withAgentQuota(auth, async () => {
     const timeoutMs = agentTimeoutMs(); const deadline = Date.now()+timeoutMs
     let inputTokens = 0; let outputTokens = 0
     let raw = ''
     for (let attempt = 0; ; attempt++) {
      try {
       raw = await completeJson({ ...agentPrompt(input,access), structured: true, model: process.env.OPENAI_MODEL || 'gpt-6-luna', maxTokens: agentMaxOutputTokens(), timeoutMs: Math.max(1,deadline-Date.now()), onUsage: (input,output) => { inputTokens=input; outputTokens=output; tokensIn=input; tokensOut=output } })
       break
      } catch (error) { if (!(error instanceof AiCompletionError && error.transient) || attempt >= 1 || Date.now() >= deadline) throw error }
     }
     if (!raw.trim()) throw new AiCompletionError('empty_output')
     let validated: AgentReply
     try { validated = parseAgentOutput(raw,access) }
     catch { throw new AiCompletionError('invalid_json') }
     success = true
     return { reply: validated, inputTokens, outputTokens }
    })
    counted = reply.layer === 'ai' || reply.layer === 'offtopic'
   } catch (error) {
    if (error instanceof AiCompletionError) { reason = error.reason; code = error.code; success = error.transient ? false : null }
    else { reason = error instanceof AiProviderNotConfiguredError ? 'no_provider' : 'internal_error'; success = null }
    reply = unavailableReply()
   }
   finally { agentResilience.leave(success) }
  }
 }
 if (!counted) await recordAgentMetric(auth,reply)
 console.info(JSON.stringify({ event: 'agent_message', userId: auth.sub, tenantId: auth.tenantId, layer: reply.layer, tokensIn, tokensOut, durationMs: Date.now()-started, reason, code }))
 return reply
}
