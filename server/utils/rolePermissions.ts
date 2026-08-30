import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, roleEntityPermissions, roles } from '~/server/db/schema'

// HU-ERD-33: logica de la pantalla de gestion de roles y permisos, separada
// de los endpoints (mismo patron que dashboardMetrics.ts/HU-ERD-31) para
// poder testearla sin pasar por HTTP.

type Tx = typeof db

export interface RoleSummary {
  id: string
  name: string
  isSystem: boolean
}

export interface EntityPermissionRow {
  entityId: string
  entitySlug: string
  entityName: string
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export interface RolePermissionsResult {
  role: RoleSummary
  permissions: EntityPermissionRow[]
}

export interface PermissionUpdate {
  entityId: string
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export async function listRoles(tenantId: string): Promise<RoleSummary[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(roles.name)
  )
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
    .select({ id: entities.id, slug: entities.slug, name: entities.name })
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
      canRead: existing?.canRead ?? false,
      canCreate: existing?.canCreate ?? false,
      canUpdate: existing?.canUpdate ?? false,
      canDelete: existing?.canDelete ?? false
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
          canDelete: update.canDelete
        })
        .onConflictDoUpdate({
          target: [roleEntityPermissions.roleId, roleEntityPermissions.entityId],
          set: {
            canRead: update.canRead,
            canCreate: update.canCreate,
            canUpdate: update.canUpdate,
            canDelete: update.canDelete
          }
        })
    }

    return loadRolePermissions(tx, tenantId, roleId)
  })
}
