import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { roles } from '~/server/db/schema'
import { completeJson } from '~/server/utils/aiProvider'
import { showDesignerAccess } from '~/utils/onboardingTours'
import type { AuthTokenPayload } from '~/server/utils/auth'
import type { AgentReply } from '~/utils/agentConversation'
import { agentPrompt, cheapAgentReply, parseAgentOutput, unavailableReply, type AgentInput } from './layers'
import { agentResilience, agentTimeoutMs } from './resilience'
import { recordAgentMetric, withAgentQuota, readAgentPlan } from './usage'
export async function resolveAgentMessage(auth: AuthTokenPayload, input: AgentInput): Promise<AgentReply> {
 const started = Date.now()
 const [role] = await withTenant(auth.tenantId, tx => tx.select({ admin: roles.isSystem }).from(roles).where(and(eq(roles.id,auth.roleId!),eq(roles.tenantId,auth.tenantId))).limit(1))
 const plan = await readAgentPlan(auth.tenantId)
 const access = { isAdmin: role?.admin === true, designerAvailable: showDesignerAccess(plan.code) }
 let reply = cheapAgentReply(input,access)
 let counted = false
 let tokensIn = 0; let tokensOut = 0
 if (!reply) {
  const retry = agentResilience.rate(`${auth.tenantId}:${auth.sub}`) || agentResilience.rate(`tenant:${auth.tenantId}`)
  if (retry) reply = { reply: 'Vamos un poco más despacio. En un momento podemos continuar; también puedo indicarte las pantallas de Flow.', emotion: 'idle', actions: [], layer: 'limited', retryAfterSec: retry }
  else if (!process.env.AI_PROVIDER || !(process.env.AI_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.AI_PROVIDER === 'anthropic' ? process.env.ANTHROPIC_API_KEY : false)) reply = { ...unavailableReply(), reply: 'Todavía no tengo mi cerebro de IA activado. Sí puedo guiarte por las pantallas y recorridos de Flow.' }
  else if (!agentResilience.enter()) reply = unavailableReply()
  else {
   let success: boolean | null = null
   try {
    reply = await withAgentQuota(auth, async () => {
     success = false
     const timeoutMs = agentTimeoutMs(); const deadline = Date.now()+timeoutMs
     let inputTokens = 0; let outputTokens = 0
     let raw = ''
     for (let attempt = 0; ; attempt++) {
      try {
       raw = await completeJson({ ...agentPrompt(input,access), structured: true, model: process.env.OPENAI_MODEL || 'gpt-6-luna', maxTokens: 400, timeoutMs: Math.max(1,deadline-Date.now()), onUsage: (input,output) => { inputTokens=input; outputTokens=output; tokensIn=input; tokensOut=output } })
       break
      } catch (error) { if (attempt >= 1 || Date.now() >= deadline) throw error }
     }
     const validated = parseAgentOutput(raw,access)
     success = true
     return { reply: validated, inputTokens, outputTokens }
    })
    counted = reply.layer === 'ai' || reply.layer === 'offtopic'
   } catch { reply = unavailableReply() }
   finally { agentResilience.leave(success) }
  }
 }
 if (!counted) await recordAgentMetric(auth,reply)
 console.info(JSON.stringify({ event: 'agent_message', userId: auth.sub, tenantId: auth.tenantId, layer: reply.layer, tokensIn, tokensOut, durationMs: Date.now()-started }))
 return reply
}
