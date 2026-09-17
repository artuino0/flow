import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { apiKeys, entities, roleEntityPermissions, users } from '~/server/db/schema'
import { createApiKeyToken } from '~/server/utils/apiKeys'
import { requireAdminRole, requireAuth } from '~/server/utils/rbac'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  ownerUserId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.record(z.string(), z.object({ read: z.boolean().optional(), create: z.boolean().optional(), update: z.boolean().optional(), delete: z.boolean().optional() })).default({})
})

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Usa tu sesión para administrar API keys' })
  const body = await readValidatedBody(event, bodySchema.parse)
  if (body.expiresAt && new Date(body.expiresAt) <= new Date()) throw createError({ statusCode: 400, statusMessage: 'La fecha de vencimiento debe ser futura' })
  let ownerUserId = auth.sub
  try { await requireAdminRole(event); ownerUserId = body.ownerUserId || auth.sub } catch {
    if (body.ownerUserId && body.ownerUserId !== auth.sub) throw createError({ statusCode: 403, statusMessage: 'Solo un administrador puede elegir el propietario' })
  }
  const tokenData = createApiKeyToken(auth.tenantId)
  const created = await withTenant(auth.tenantId, async (tx) => {
    const [owner] = await tx.select({ id: users.id, roleId: users.roleId }).from(users).where(and(eq(users.id, ownerUserId), eq(users.tenantId, auth.tenantId), eq(users.isActive, true))).limit(1)
    if (!owner) throw createError({ statusCode: 400, statusMessage: 'El propietario no pertenece a esta organización o está inactivo' })
    const requested = Object.entries(body.scopes)
    if (requested.length === 0) throw createError({ statusCode: 400, statusMessage: 'Selecciona al menos un permiso de módulo' })
    if (!requested.some(([, scope]) => Object.values(scope).some(Boolean))) throw createError({ statusCode: 400, statusMessage: 'Selecciona al menos un permiso de módulo' })
    for (const [slug, scope] of requested) {
      const [entity] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, auth.tenantId), eq(entities.slug, slug))).limit(1)
      if (!entity) throw createError({ statusCode: 400, statusMessage: `El módulo "${slug}" no existe` })
      const [perm] = owner.roleId ? await tx.select().from(roleEntityPermissions).where(and(eq(roleEntityPermissions.roleId, owner.roleId), eq(roleEntityPermissions.entityId, entity.id))).limit(1) : []
      const allowed = { read: Boolean(perm?.canRead), create: Boolean(perm?.canCreate), update: Boolean(perm?.canUpdate), delete: Boolean(perm?.canDelete) }
      if (Object.entries(scope).some(([action, value]) => value && !allowed[action as keyof typeof allowed])) throw createError({ statusCode: 403, statusMessage: `El propietario no tiene alguno de los permisos solicitados para "${slug}"` })
    }
    const [row] = await tx.insert(apiKeys).values({ tenantId: auth.tenantId, ownerUserId, name: body.name, prefix: tokenData.prefix, tokenHash: tokenData.hash, scopes: body.scopes, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }).returning()
    return row
  })
  return { id: created.id, name: created.name, prefix: created.prefix, token: tokenData.token, expiresAt: created.expiresAt, scopes: created.scopes }
})
