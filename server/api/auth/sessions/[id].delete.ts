import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { requireAuth } from '~/server/utils/rbac'
import { invalidateTenantSessions } from '~/server/utils/shortCache'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Usa tu sesión para administrar dispositivos' })
  const id = z.union([z.literal('all'), z.string().uuid()]).parse(getRouterParam(event, 'id'))
  await withTenant(auth.tenantId, tx => tx.execute(sql`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${auth.sub}::uuid AND ${id === 'all' ? sql`true` : sql`id = ${id}::uuid`}`))
  invalidateTenantSessions(auth.tenantId)
  return { ok: true }
})
