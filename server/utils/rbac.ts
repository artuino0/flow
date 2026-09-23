import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions, roles } from '~/server/db/schema'
import type { AuthTokenPayload } from '~/server/utils/auth'

export type PermissionAction = 'canRead' | 'canCreate' | 'canUpdate' | 'canDelete'

export interface ResolvedEntity {
  id: string
  slug: string
  name: string
  // Rediseno "Editar Módulo" - ver comentario largo en server/db/schema.ts.
  isActive?: boolean
  deletedAt?: Date | null
  // HU-ERD-74: incluida explicitamente en el select() de requirePermission()
  // (ver abajo) para que fields.get.ts pueda resolver el detailLayout real,
  // no siempre el default.
  detailLayout?: unknown
  // HU-ERD-75: mismo motivo que detailLayout de arriba - incluida desde el
  // primer commit de esta HU (la de detailLayout se agrego recien en ERD-74
  // tras un bug real encontrado por tests e2e; se aplica la leccion aca).
  listLayout?: unknown
  boardConfig?: unknown
  // Reportado por el usuario (2026-09-03): campo propio (texto) que se usa
  // como etiqueta cuando ESTA entidad es el destino de una relacion (ver
  // comentario largo en server/db/schema.ts) - incluida aca por el mismo
  // motivo que detailLayout/listLayout: fields.get.ts la expone en `entity`
  // para que el picker "Campo a mostrar" (ModuleListLayoutCard.vue) sepa la
  // eleccion vigente.
  labelField?: string | null
  // Pedido directo del usuario (2026-09-05): "Nombre en singular" opcional -
  // ver comentario largo en server/db/schema.ts (entities.singularName).
  // Incluida aca por el mismo motivo que labelField: fields.get.ts la expone
  // en `entity` para que pages/registros/:entity/nuevo.vue y .../:id/editar.vue
  // sepan si hay un singular explicito o deben seguir usando `name` tal cual.
  singularName?: string | null
}

export interface PermissionResult {
  auth: AuthTokenPayload
  entity: ResolvedEntity
}

/**
 * Guard minimo: solo exige un usuario autenticado con rol asignado, sin
 * ningun chequeo de permiso puntual encima (a diferencia de requirePermission/
 * requireAdminRole). Exportada (reubicacion del menu, post-HU-ERD-67) para
 * pantallas como el Tablero (ex-Dashboard) que dejaron de ser exclusivas de
 * administrador: cualquier usuario autenticado del tenant puede verlas.
 */
export function requireAuth(event: H3Event): AuthTokenPayload {
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
  const auth = requireAuth(event)

  const result = await withTenant(auth.tenantId, async (tx) => {
    const [entity] = await tx
      // HU-ERD-74: detailLayout va explicito en el select (antes faltaba, y
      // GET /api/entities/:entity/fields terminaba resolviendo SIEMPRE el
      // layout por defecto porque entity.detailLayout era undefined - bug
      // real encontrado via test e2e, no solo un TS gap).
      .select({
        id: entities.id,
        slug: entities.slug,
        name: entities.name,
        isActive: entities.isActive,
        deletedAt: entities.deletedAt,
        detailLayout: entities.detailLayout,
        listLayout: entities.listLayout,
        boardConfig: entities.boardConfig,
        labelField: entities.labelField,
        singularName: entities.singularName
      })
      .from(entities)
      .where(and(eq(entities.tenantId, auth.tenantId), eq(entities.slug, entitySlug)))
      .limit(1)
    if (!entity) return { entity: null, allowed: false, inactive: false }

    // La lectura histórica sigue disponible con canRead. Toda escritura en
    // módulos apagados o borrados queda bloqueada, incluso para administradores.
    if ((!entity.isActive || entity.deletedAt) && action !== 'canRead') {
      return { entity, allowed: false, inactive: true }
    }

    const [perm] = await tx
      .select({
        canRead: roleEntityPermissions.canRead,
        canCreate: roleEntityPermissions.canCreate,
        canUpdate: roleEntityPermissions.canUpdate,
        canDelete: roleEntityPermissions.canDelete,
        isActive: entities.isActive,
        deletedAt: entities.deletedAt
      })
      .from(roleEntityPermissions)
      .innerJoin(entities, eq(entities.id, roleEntityPermissions.entityId))
      .where(and(eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.entityId, entity.id)))
      .limit(1)
    if (!perm) return { entity, allowed: false, inactive: false }

    const apiKeyScopes = event.context.apiKeyScopes as Record<string, Record<string, boolean>> | undefined
    if (apiKeyScopes) {
      const scope = apiKeyScopes[entity.slug]
      const actionMap: Record<PermissionAction, string> = { canRead: 'read', canCreate: 'create', canUpdate: 'update', canDelete: 'delete' }
      if (!scope?.[actionMap[action]]) return { entity, allowed: false, inactive: false }
    }

    return { entity, allowed: Boolean(perm[action]), inactive: false }
  })

  if (!result.entity) {
    throw createError({ statusCode: 404, statusMessage: `Entidad "${entitySlug}" no existe` })
  }
  if (result.inactive) {
    throw createError({ statusCode: 403, statusMessage: `El modulo "${entitySlug}" esta desactivado` })
  }
  if (!result.allowed) {
    throw createError({ statusCode: 403, statusMessage: `No tienes permiso "${action}" sobre "${entitySlug}"` })
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
  const auth = requireAuth(event)

  const allowed = await withTenant(auth.tenantId, async (tx) => {
    const [perm] = await tx
      .select({ allowed: roleEntityPermissions[action], isActive: entities.isActive, deletedAt: entities.deletedAt })
      .from(roleEntityPermissions)
      .innerJoin(entities, eq(entities.id, roleEntityPermissions.entityId))
      .where(and(eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.entityId, entityId)))
      .limit(1)
    if (!perm) return false
    return Boolean(perm.allowed && (action === 'canRead' || (perm.isActive && !perm.deletedAt)))
  })

  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: `No tienes permiso "${action}" sobre esta entidad` })
  }
  return auth
}

export interface PermissionFlags {
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

/**
 * Devuelve los 4 flags de permiso del rol del usuario sobre una entidad
 * (HU-ERD-24). No reemplaza a requirePermission (que ademas resuelve la
 * entidad por slug y lanza 403 si falta el permiso puntual pedido) - esto es
 * para cuando el frontend necesita los 4 a la vez, para decidir que botones
 * mostrar (Nuevo/Editar/Eliminar) sin adivinar. Mismo gap que fields.get.ts:
 * ERD-43 (listado de entidades) devolvera esto tambien a nivel de menu, pero
 * el Table Builder lo necesita ya, por entidad puntual.
 */
export async function getPermissionFlags(auth: AuthTokenPayload, entityId: string): Promise<PermissionFlags> {
  if (!auth.roleId) {
    return { canRead: false, canCreate: false, canUpdate: false, canDelete: false }
  }

  return withTenant(auth.tenantId, async (tx) => {
    const [perm] = await tx
      .select({
        canRead: roleEntityPermissions.canRead,
        canCreate: roleEntityPermissions.canCreate,
        canUpdate: roleEntityPermissions.canUpdate,
        canDelete: roleEntityPermissions.canDelete,
        isActive: entities.isActive,
        deletedAt: entities.deletedAt
      })
      .from(roleEntityPermissions)
      .innerJoin(entities, eq(entities.id, roleEntityPermissions.entityId))
      .where(and(eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.entityId, entityId)))
      .limit(1)
    if (!perm) return { canRead: false, canCreate: false, canUpdate: false, canDelete: false }
    return {
      canRead: perm.canRead,
      canCreate: perm.canCreate && perm.isActive && !perm.deletedAt,
      canUpdate: perm.canUpdate && perm.isActive && !perm.deletedAt,
      canDelete: perm.canDelete && perm.isActive && !perm.deletedAt
    }
  })
}

/**
 * Guard para pantallas de administracion del propio tenant (HU-ERD-61, ej.
 * Configuracion General) que no encajan en el modelo de permisos por entidad
 * de role_entity_permissions (no son un modulo dinamico). No existe todavia
 * un concepto formal de "rol administrador" en el sistema - se reutiliza
 * roles.isSystem (ya existente, sin uso hasta ahora) como esa senal: el rol
 * creado como "de sistema" para el tenant es el que tiene acceso total.
 * Si en el futuro se necesita un modelo mas fino, esto es lo primero a revisar.
 */
export async function requireAdminRole(event: H3Event): Promise<AuthTokenPayload> {
  const auth = requireAuth(event)

  // Las API keys sirven para operar datos con scopes, nunca para entrar a la
  // configuración administrativa ni modificar permisos/credenciales.
  if (event.context.apiKeyId) {
    throw createError({ statusCode: 403, statusMessage: 'Las API keys no pueden administrar la organización' })
  }

  const isAdmin = await withTenant(auth.tenantId, async (tx) => {
    const [role] = await tx
      .select({ isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, auth.roleId!))
      .limit(1)
    return Boolean(role?.isSystem)
  })

  if (!isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Requiere rol administrador' })
  }
  return auth
}
