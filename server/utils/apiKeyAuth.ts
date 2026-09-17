import { and, eq, gt, isNull, or } from 'drizzle-orm'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { withTenant } from '~/server/db'
import { apiKeys, users } from '~/server/db/schema'
import { hashApiKey } from '~/server/utils/apiKeys'

const TOKEN_RE = /^fer_live_([0-9a-f-]{36})\.(.+)$/i

export interface ApiKeyAuthResult {
  auth: AuthTokenPayload
  apiKeyId: string
  scopes: unknown
}

export async function resolveApiKeyAuth(token: string): Promise<ApiKeyAuthResult | null> {
  const match = TOKEN_RE.exec(token)
  if (!match) return null
  const tenantId = match[1]
  const tokenHash = hashApiKey(token)
  return withTenant(tenantId, async (tx) => {
    const now = new Date()
    const [row] = await tx
      .select({ keyId: apiKeys.id, ownerUserId: apiKeys.ownerUserId, roleId: users.roleId, scopes: apiKeys.scopes })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.ownerUserId))
      .where(and(
        eq(apiKeys.tenantId, tenantId),
        eq(apiKeys.tokenHash, tokenHash),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
      ))
      .limit(1)
    if (!row) return null
    await tx.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.keyId))
    return { auth: { sub: row.ownerUserId, tenantId, roleId: row.roleId }, apiKeyId: row.keyId, scopes: row.scopes }
  })
}
