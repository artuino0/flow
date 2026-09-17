import { sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { requireAuth } from '~/server/utils/rbac'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Usa tu sesión para administrar dispositivos' })
  const rows = await withTenant(auth.tenantId, tx => tx.execute(sql`SELECT s.id, s.user_agent, s.created_at, s.last_seen_at FROM auth_sessions s JOIN tenants t ON t.id = s.tenant_id WHERE s.user_id = ${auth.sub}::uuid AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at + t.idle_timeout_minutes * interval '1 minute' > now() ORDER BY s.last_seen_at DESC`))
  return rows.map(row => ({ id: row.id, userAgent: row.user_agent, createdAt: row.created_at, lastSeenAt: row.last_seen_at, current: row.id === auth.sid }))
})
