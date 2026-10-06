import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { withTenantRecovery as withTenant } from '~/server/db'
import { sessionCache } from '~/server/utils/shortCache'

type SessionOwner = { sub: string; tenantId: string; sid?: string }

export async function createSession(event: H3Event, owner: SessionOwner): Promise<string> {
  return withTenant(owner.tenantId, async tx => {
    const rows = await tx.execute(sql`INSERT INTO auth_sessions (tenant_id, user_id, user_agent, expires_at) VALUES (${owner.tenantId}::uuid, ${owner.sub}::uuid, ${(getHeader(event, 'user-agent') || '').slice(0, 500)}, now() + interval '7 days') RETURNING id`)
    return String(rows[0].id)
  })
}

export async function validateSession(owner: SessionOwner, touch = false) {
  // Existing signed access tokens remain valid until their short expiry.
  // Their next refresh creates a managed session.
  if (!owner.sid) return
  // Una sesión ya validada hace unos segundos no vuelve a consultarse (SESSION_CACHE_TTL_MS,
  // 10 s por defecto): ahorra una transacción por petición. Revocar una sesión limpia el caché
  // de esta instancia al instante; en otras instancias surte efecto a lo más al vencer el tiempo.
  // Nunca se usa al "tocar" la sesión (refresco): esa ruta siempre va a la base.
  const cacheKey = `${owner.tenantId}:${owner.sid}:${owner.sub}`
  if (!touch && sessionCache.get(cacheKey)) return
  await withTenant(owner.tenantId, async tx => {
    const rows = await tx.execute(sql`SELECT s.id FROM auth_sessions s
      JOIN tenants t ON t.id = s.tenant_id JOIN users u ON u.id = s.user_id
      WHERE s.id = ${owner.sid}::uuid AND s.user_id = ${owner.sub}::uuid
      AND s.tenant_id = ${owner.tenantId}::uuid AND u.is_active = true
      AND s.revoked_at IS NULL AND s.expires_at > now()
      AND s.last_seen_at + t.idle_timeout_minutes * interval '1 minute' + interval '30 seconds' > now()`)
    if (!rows.length) throw createError({ statusCode: 401, statusMessage: 'Sesión cerrada o expirada' })
    if (touch) await tx.execute(sql`UPDATE auth_sessions SET last_seen_at = now(), expires_at = now() + interval '7 days' WHERE id = ${owner.sid}::uuid AND revoked_at IS NULL`)
  })
  if (!touch) sessionCache.set(cacheKey, true)
}

export async function revokeSession(owner: SessionOwner) {
  if (!owner.sid) return
  sessionCache.delete(`${owner.tenantId}:${owner.sid}:${owner.sub}`)
  await withTenant(owner.tenantId, tx => tx.execute(sql`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${owner.sid}::uuid AND user_id = ${owner.sub}::uuid`))
}
