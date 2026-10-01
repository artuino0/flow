import { z } from 'zod'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { requireAgentSession } from '~/server/utils/agent/security'
import { agentUsageForTenant } from '~/server/utils/agent/usage'
const querySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), tenantId: z.string().uuid().optional() })
export default defineEventHandler(async event => {
 requireAgentSession(event)
 await requirePlatformAdmin(event)
 const query = querySchema.safeParse(getQuery(event))
 if (!query.success) throw createError({ statusCode: 400, statusMessage: 'Consulta no válida' })
 // Como platform/plans: enumerar organizaciones y SELECT separado con RLS por tenant.
 try {
 const organizations = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
 const rows = await Promise.all(organizations.filter(org => !query.data.tenantId || org.id===query.data.tenantId).map(async org => {
  const usage = await agentUsageForTenant(org.id,query.data.month)
  return { tenantId: org.id, name: org.name, plan: usage.plan, ...usage.totals, monthlyQuota: usage.quota.agentQueries, percentUsed: usage.quota.agentQueries === null ? null : usage.quota.agentQueries === 0 ? (usage.totals.ai_calls ? 100 : 0) : Math.round(usage.totals.ai_calls/usage.quota.agentQueries*100), activeUsers: usage.users.filter(user => user.messages_total > 0).length, last_used_at: usage.users.map(user => user.last_used_at).filter((date): date is string => Boolean(date)).sort().at(-1) || null, ...(query.data.tenantId ? { users: usage.users } : {}) }
 }))
 setHeader(event,'Cache-Control','no-store')
 return { organizations: rows.sort((a,b) => b.ai_calls-a.ai_calls) }
 } catch { throw createError({ statusCode: 503, statusMessage: 'Consumo no disponible' }) }
})
