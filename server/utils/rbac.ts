import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions } from '~/server/db/schema'
import type { AuthTokenPayload } from '~/server/utils/auth'

export type PermissionAction = 'canRead' | 'canCreate' | 'canUpdate' | 'canDelete'

export interface ResolvedEntity {
  id: string
  slug: string
  name: string
}

export interface PermissionResult {
  auth: AuthTokenPayload
  entity: ResolvedEntity
}

function getAuthOrThrow(event: H3Event): AuthTokenPayload {
  const auth = event.context.auth as AuthTokenPayload | undefined
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }
  if (!auth.roleId) {
    throw createError({ statusCode: 403, statusMessage: 'Usuario sin rol asignado' })
  }
  return auth
}

/**
 * Guard reutilizable (HU-ERD-15) para endpoints genericos: valida que el rol
 * del usuario autenticado tenga el permiso pedido sobre la entidad indicada
 * (por slug), dentro de su tenant. Lanza 401/403/404 si no corresponde y
 * devuelve tanto el auth como la entidad ya resuelta (evita resolverla dos
 * veces en cada endpoint de records, HU-ERD-16).
 */
export async function requirePermission(
  event: H3Event,
  entitySlug: string,
  action: PermissionAction
): Promise<PermissionResult> {
  const auth = getAuthOrThrow(event)

  const result = await withTenant(auth.tenantId, async (tx) => {
    const [entity] = await tx
      .select({ id: entities.id, slug: entities.slug, name: entities.name })
      .from(entities)
      .where(and(eq(entities.tenantId, auth.tenantId), eq(entities.slug, entitySlug)))
      .limit(1)
    if (!entity) return { entity: null, allowed: false }

    const [perm] = await tx
      .select()
      .from(roleEntityPermissions)
      .where(and(eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.entityId, entity.id)))
      .limit(1)
    if (!perm) return { entity, allowed: false }

    return { entity, allowed: Boolean(perm[action]) }
  })

  if (!result.entity) {
    throw createError({ statusCode: 404, statusMessage: `Entidad "${entitySlug}" no existe` })
  }
  if (!result.allowed) {
    throw createError({ statusCode: 403, statusMessage: `No tenes permiso "${action}" sobre "${entitySlug}"` })
  }

  return { auth, entity: result.entity }
}

/**
 * Variante de requirePermission() para cuando ya se conoce el entityId
 * directamente (p. ej. via relation_definitions.source_entity_id /
 * target_entity_id, HU-ERD-19) y no hace falta resolverlo por slug. No
 * lanza 404 de entidad (se asume que el caller ya la resolvio); solo
 * valida el permiso del rol sobre esa entidad. Devuelve el auth.
 */
export async function requirePermissionForEntityId(
  event: H3Event,
  entityId: string,
  action: PermissionAction
): Promise<AuthTokenPayload> {
  const auth = getAuthOrThrow(event)

  const allowed = await withTenant(auth.tenantId, async (tx) => {
    const [perm] = await tx
      .select()
      .from(roleEntityPermissions)
      .where(and(eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.entityId, entityId)))
      .limit(1)
    if (!perm) return false
    return Boolean(perm[action])
  })

  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: `No tenes permiso "${action}" sobre esta entidad` })
  }
  return auth
}
