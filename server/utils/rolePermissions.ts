import { and, count, eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, roleEntityPermissions, roles, users } from '~/server/db/schema'

// HU-ERD-33: logica de la pantalla de gestion de roles y permisos, separada
// de los endpoints (mismo patron que dashboardMetrics.ts/HU-ERD-31) para
// poder testearla sin pasar por HTTP.

type Tx = typeof db

// Postgres SQLSTATE - la libreria "postgres" expone el codigo en err.code.
// Mismo criterio de traducir errores de Postgres a HTTP que moduleEntities.ts
// (HU-ERD-66, DuplicateSlugError) - roles_tenant_name_unique (schema.ts) es
// el analogo de entities_tenant_slug_unique para roles.
const PG_UNIQUE_VIOLATION = '23505'

export class DuplicateRoleNameError extends Error {}
export class ReferenceRoleNotFoundError extends Error {}

export interface RoleSummary {
  id: string
  name: string
  isSystem: boolean
  // Rediseno "pantalla unica" (ver comentario largo en pages/roles/index.vue)
  // - el diseno real en Pencil (Role Selector, nodo CW5XH) muestra "N
  // usuarios" bajo cada rol, tanto en el selector como en su panel
  // desplegable. Cuenta users.role_id = roles.id (users.roleId es nullable -
  // un usuario sin rol asignado no cuenta para ninguno).
  userCount: number
}

export interface EntityPermissionRow {
  moduleKind: 'hecho' | 'dimension'
  showInMenu: boolean
  entityId: string
  entitySlug: string
  entityName: string
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export interface RolePermissionsResult {
  // Sin userCount: GET/PUT .../permissions no lo necesita (la pantalla ya
  // lo tiene por el listado de roles cargado aparte) y evitar el join extra
  // ahi mantiene loadRolePermissions() liviano.
  role: { id: string; name: string; isSystem: boolean }
  permissions: EntityPermissionRow[]
}

export interface PermissionUpdate {
  showInMenu?: boolean
  entityId: string
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export async function listRoles(tenantId: string): Promise<RoleSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const roleRows = await tx
      .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(roles.name)

    // users no tiene RLS propio (no hay tenant_id en su WHERE explicito aca
    // porque el join por roleId ya lo acota a roles de este tenant) - mismo
    // criterio de "acotar por los ids ya resueltos del tenant, no por RLS
    // ajeno" que fieldCount en moduleEntities.ts (HU-ERD-69).
    const userCountRows = await tx
      .select({ roleId: users.roleId, value: count() })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .groupBy(users.roleId)
    const userCountByRoleId = new Map(userCountRows.map((r) => [r.roleId, r.value]))

    return roleRows.map((role) => ({ ...role, userCount: userCountByRoleId.get(role.id) ?? 0 }))
  })
}

export interface CreateRoleResult extends RoleSummary {
  // Rediseno "Nuevo Rol" (2026-09-01, "checa esto" sobre
  // Screen/Roles y Permisos - Nuevo Rol en el .pen): cantidad de flags de
  // permiso (true) copiados del rol de referencia, si se paso copyFromRoleId -
  // 0 si no se copio nada. Es el numero que el modal muestra de vuelta
  // ("Se copiaron los N permisos de <rol>") una vez creado.
  copiedPermissionCount: number
}

/**
 * Crea un rol nuevo (isSystem=false siempre - el rol de sistema del tenant
 * se crea una unica vez en el alta del tenant, HU-ERD-61, nunca desde aca).
 *
 * Rediseno "Nuevo Rol" (2026-09-01): revisando Screen/Roles y Permisos -
 * Nuevo Rol en el .pen (pedido del usuario: "checa esto") se encontro que el
 * modal real de creacion tiene una seccion "Copiar permisos de (opcional)" -
 * sin ella, todo rol nuevo arrancaba SIEMPRE sin ningun permiso, obligando a
 * marcar la Permission Matrix entera a mano incluso para roles muy parecidos
 * a uno ya existente (ej. "Ventas Junior" calcado de "Ventas"). copyFromRoleId
 * es opcional - sin el, se mantiene el comportamiento anterior (sin permisos
 * iniciales; loadRolePermissions() ya devuelve false por defecto para toda
 * entidad sin fila propia en role_entity_permissions).
 *
 * El rol de referencia se valida ANTES de crear el rol nuevo (ReferenceRoleNotFoundError,
 * 404 en el endpoint) para no dejar un rol huerfano si el id no existe o es
 * de otro tenant. Solo se copian filas con AL MENOS un flag en true - una
 * fila toda-false no aporta nada y ademas asi copiedPermissionCount (suma de
 * flags true) coincide exactamente con lo que se inserta.
 *
 * roles_tenant_name_unique (schema.ts) evita nombres duplicados dentro del
 * tenant - mismo criterio de traducir el unique_violation de Postgres a un
 * error propio que DuplicateSlugError en moduleEntities.ts (HU-ERD-66).
 */
export async function createRole(tenantId: string, name: string, copyFromRoleId?: string | null): Promise<CreateRoleResult> {
  return withTenant(tenantId, async (tx) => {
    let sourcePerms: (typeof roleEntityPermissions.$inferSelect)[] = []
    if (copyFromRoleId) {
      const [sourceRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, copyFromRoleId), eq(roles.tenantId, tenantId)))
        .limit(1)
      if (!sourceRole) {
        throw new ReferenceRoleNotFoundError('El rol de referencia no existe')
      }
      sourcePerms = await tx.select().from(roleEntityPermissions).where(eq(roleEntityPermissions.roleId, copyFromRoleId))
    }

    let role: typeof roles.$inferSelect
    try {
      ;[role] = await tx.insert(roles).values({ tenantId, name, isSystem: false }).returning()
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateRoleNameError(`Ya existe un rol con el nombre "${name}"`)
      }
      throw err
    }

    let copiedPermissionCount = 0
    for (const p of sourcePerms) {
      const flags = [p.canRead, p.canCreate, p.canUpdate, p.canDelete]
      const trueCount = flags.filter(Boolean).length
      if (trueCount === 0) continue
      await tx.insert(roleEntityPermissions).values({
        roleId: role.id,
        entityId: p.entityId,
        canRead: p.canRead,
        canCreate: p.canCreate,
        canUpdate: p.canUpdate,
        canDelete: p.canDelete,
        showInMenu: p.showInMenu
      })
      copiedPermissionCount += trueCount
    }

    return { id: role.id, name: role.name, isSystem: role.isSystem, userCount: 0, copiedPermissionCount }
  })
}

/**
 * Arma el resultado (rol + permisos por entidad, en false por defecto donde
 * todavia no hay fila en role_entity_permissions) usando una `tx` YA abierta
 * - a proposito no llama a withTenant() de nuevo: setRolePermissions() la
 * reusa para leer el estado final DENTRO de la misma transaccion que acaba
 * de escribir, en vez de abrir una transaccion nueva que todavia no veria
 * esos cambios (READ COMMITTED: una transaccion nueva no ve el trabajo sin
 * commitear de otra, aunque sea la misma request).
 */
async function loadRolePermissions(tx: Tx, tenantId: string, roleId: string): Promise<RolePermissionsResult | null> {
  const [role] = await tx
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
    .limit(1)
  if (!role) return null

  const tenantEntities = await tx
    .select({ id: entities.id, slug: entities.slug, name: entities.name, moduleKind: entities.moduleKind })
    .from(entities)
    .where(eq(entities.tenantId, tenantId))
    .orderBy(entities.name)

  const existingPerms = await tx.select().from(roleEntityPermissions).where(eq(roleEntityPermissions.roleId, roleId))
  const permsByEntityId = new Map(existingPerms.map((p) => [p.entityId, p]))

  const permissions: EntityPermissionRow[] = tenantEntities.map((entity) => {
    const existing = permsByEntityId.get(entity.id)
    return {
      entityId: entity.id,
      entitySlug: entity.slug,
      entityName: entity.name,
      moduleKind: entity.moduleKind as 'hecho' | 'dimension',
      canRead: existing?.canRead ?? false,
      canCreate: existing?.canCreate ?? false,
      canUpdate: existing?.canUpdate ?? false,
      canDelete: existing?.canDelete ?? false,
      showInMenu: existing?.showInMenu ?? true
    }
  })

  return { role, permissions }
}

/**
 * Devuelve el rol (validado que sea del tenant) y, para CADA entidad del
 * tenant, sus flags de permiso. Devuelve null si el rol no existe o no es de
 * este tenant (404 en el endpoint).
 */
export async function getRolePermissions(tenantId: string, roleId: string): Promise<RolePermissionsResult | null> {
  return withTenant(tenantId, (tx) => loadRolePermissions(tx, tenantId, roleId))
}

/**
 * Guarda los permisos de un rol sobre un conjunto de entidades (upsert por
 * (role_id, entity_id), unico de role_entity_permissions). Cada entityId se
 * valida contra `entities` del MISMO tenant antes de guardar nada - nunca se
 * confia en un entityId suelto que venga del body (podria ser de otro tenant).
 * Devuelve null si el rol no existe/no es del tenant, o si algun entityId no
 * pertenece al tenant (en vez de guardar parcialmente).
 */
export async function setRolePermissions(
  tenantId: string,
  roleId: string,
  updates: PermissionUpdate[]
): Promise<RolePermissionsResult | null> {
  return withTenant(tenantId, async (tx) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
      .limit(1)
    if (!role) return null

    const tenantEntities = await tx.select({ id: entities.id }).from(entities).where(eq(entities.tenantId, tenantId))
    const validEntityIds = new Set(tenantEntities.map((e) => e.id))

    for (const update of updates) {
      if (!validEntityIds.has(update.entityId)) return null
    }

    for (const update of updates) {
      await tx
        .insert(roleEntityPermissions)
        .values({
          roleId,
          entityId: update.entityId,
          canRead: update.canRead,
          canCreate: update.canCreate,
          canUpdate: update.canUpdate,
          canDelete: update.canDelete,
          showInMenu: update.showInMenu ?? true
        })
        .onConflictDoUpdate({
          target: [roleEntityPermissions.roleId, roleEntityPermissions.entityId],
          set: {
            canRead: update.canRead,
            canCreate: update.canCreate,
            canUpdate: update.canUpdate,
            canDelete: update.canDelete,
            ...(update.showInMenu === undefined ? {} : { showInMenu: update.showInMenu })
          }
        })
    }

    return loadRolePermissions(tx, tenantId, roleId)
  })
}
