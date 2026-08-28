import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions } from '~/server/db/schema'
import type { AuthTokenPayload } from '~/server/utils/auth'

export type PermissionAction = 'canRead' | 'canCreate' | 'canUpdate' | 'canDelete'

/**
 * Guard reutilizable (HU-ERD-15) para endpoints genericos: valida que el rol
 * del usuario autenticado tenga el permiso pedido sobre la entidad indicada
 * (por slug), dentro de su tenant. Lanza 401/403 si no corresponde.
 */
export async function requirePermission(
  event: H3Event,
  entitySlug: string,
  action: PermissionAction
): Promise<AuthTokenPayload> {
  const auth = event.context.auth as AuthTokenPayload | undefined
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }
  if (!auth.roleId) {
    throw createError({ statusCode: 403, statusMessage: 'Usuario sin rol asignado' })
  }

  const allowed = await withTenant(auth.tenantId, async (tx) => {
    const [entity] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.tenantId, auth.tenantId), eq(entities.slug, entitySlug)))
      .limit(1)
    if (!entity) return false

    const [perm] = await tx
      .select()
      .from(roleEntityPermissions)
      .where(and(eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.entityId, entity.id)))
      .limit(1)
    if (!perm) return false

    return Boolean(perm[action])
  })

  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: `No tenes permiso "${action}" sobre "${entitySlug}"` })
  }

  return auth
}
