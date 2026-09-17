import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { apiKeys, people, users } from '~/server/db/schema'
import { requireAdminRole, requireAuth } from '~/server/utils/rbac'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Usa tu sesión para administrar API keys' })
  const isAdmin = await (async () => {
    try { await requireAdminRole(event); return true } catch { return false }
  })()
  const rows = await withTenant(auth.tenantId, async (tx) => tx
    .select({ key: apiKeys, ownerName: people.fullName, ownerEmail: people.email })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.ownerUserId))
    .innerJoin(people, eq(people.id, users.personId))
    .where(isAdmin && getQuery(event).mine !== 'true' ? eq(apiKeys.tenantId, auth.tenantId) : and(eq(apiKeys.tenantId, auth.tenantId), eq(apiKeys.ownerUserId, auth.sub))))
  return rows.map(({ key, ownerName, ownerEmail }) => ({
    id: key.id,
    name: key.name,
    ownerUserId: key.ownerUserId,
    ownerName: ownerName || ownerEmail,
    ownerEmail,
    prefix: key.prefix,
    scopes: key.scopes,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    lastUsedAt: key.lastUsedAt,
    status: key.revokedAt ? 'revoked' : key.expiresAt && key.expiresAt <= new Date() ? 'expired' : 'active'
  }))
})
