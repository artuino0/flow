import { z } from 'zod'
import { requireAgentSession } from '~/server/utils/agent/security'
import { requireAdminRole } from '~/server/utils/rbac'
import { agentUsageForTenant } from '~/server/utils/agent/usage'
export const usageQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
export default defineEventHandler(async event => {
 const { auth } = requireAgentSession(event)
 await requireAdminRole(event)
 const query = usageQuery.safeParse(getQuery(event))
 if (!query.success) throw createError({ statusCode: 400, statusMessage: 'Periodo no válido' })
 setHeader(event,'Cache-Control','no-store')
 try { return await agentUsageForTenant(auth.tenantId,query.data.month) }
 catch { throw createError({ statusCode: 503, statusMessage: 'Consumo no disponible' }) }
})
