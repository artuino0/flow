import { and, eq, isNull } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { apiKeys } from '~/server/db/schema'
import { requireAuth, requireAdminRole } from '~/server/utils/rbac'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Usa tu sesión para administrar API keys' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const isAdmin = await (async () => { try { await requireAdminRole(event); return true } catch { return false } })()
  const result = await withTenant(auth.tenantId, async (tx) => {
    const conditions = [eq(apiKeys.id, id), eq(apiKeys.tenantId, auth.tenantId), isNull(apiKeys.revokedAt)]
    if (!isAdmin) conditions.push(eq(apiKeys.ownerUserId, auth.sub))
    const [row] = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(...conditions)).returning({ id: apiKeys.id })
    return row
  })
  if (!result) throw createError({ statusCode: 404, statusMessage: 'API key no encontrada o ya revocada' })
  return { ok: true }
})
