import { agentBody, unavailableReply } from '~/server/utils/agent/layers'
import { requireAgentSession, agentBlocked } from '~/server/utils/agent/security'
import { resolveAgentMessage } from '~/server/utils/agent/service'
import { recordAgentMetric } from '~/server/utils/agent/usage'
export default defineEventHandler(async event => {
 if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'Método no permitido' })
 const { auth } = requireAgentSession(event)
 setHeader(event,'Cache-Control','no-store')
 let body: unknown
 try { body = await readBody(event) }
 catch { await recordAgentMetric(auth,unavailableReply()); throw createError({ statusCode: 400, statusMessage: 'Mensaje no válido' }) }
 const parsed = agentBody.safeParse(body)
 if (!parsed.success) { await recordAgentMetric(auth,unavailableReply()); throw createError({ statusCode: 400, statusMessage: 'Mensaje no válido' }) }
 try {
  const reply = await resolveAgentMessage(auth,parsed.data)
  if (reply.layer === 'limited') {
   // Alimenta la misma protección de ráfagas, manteniendo la respuesta de producto.
   try { agentBlocked(event,auth,'rate') } catch (error) { if ((error as { statusCode?: number }).statusCode === 429) throw error }
  }
  return reply
 } catch (error) {
  if ((error as { statusCode?: number }).statusCode === 429) throw error
  const reply = unavailableReply()
  await recordAgentMetric(auth,reply)
  return reply
 }
})
