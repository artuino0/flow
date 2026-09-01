import { and, count, eq, inArray } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, entityFields, records, roleEntityPermissions, roles } from '~/server/db/schema'

// HU-ERD-66: logica de "modulos" (entities) como metadatos administrables -
// hasta ahora entities/entity_fields solo se creaban por scripts/seed.mjs
// (HU-ERD-25) o SQL directo, sin ningun endpoint de escritura. Separada de
// los endpoints (mismo patron que rolePermissions.ts/dashboardMetrics.ts,
// HU-ERD-31/33) para poder testearla sin pasar por HTTP.

type Tx = typeof db

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export interface EntitySummary {
  id: string
  slug: string
  name: string
  description: string | null
  // Rediseno "Editar Módulo" (ver comentario largo en server/db/schema.ts) -
  // switch "Módulo activo". true por defecto.
  isActive: boolean
  // Pedido directo del usuario (2026-09-01): icono editable del modulo - ver
  // comentario largo en server/db/schema.ts. Null hasta que se elija uno.
  icon: string | null
  // HU-ERD-74: guardado tal cual (sin resolver contra entity_fields reales) -
  // la resolucion con defaults/reconciliacion vive en resolveDetailLayout()
  // (server/utils/detailLayout.ts), consumida por GET /api/entities/:entity/fields.
  // Opcional: listEntities() (HU-ERD-69) no lo selecciona - el listado de
  // modulos no necesita el layout de cada uno, solo create/updateEntity si.
  detailLayout?: unknown
  // HU-ERD-75: mismo criterio que detailLayout de arriba - guardado tal cual,
  // resuelto por resolveListLayout() (server/utils/listLayout.ts).
  listLayout?: unknown
}

// Postgres SQLSTATE - la libreria "postgres" expone el codigo en err.code.
// Ver mismo criterio de traducir errores de Postgres a HTTP en
// server/api/relations/index.post.ts (HU-ERD-19).
const PG_UNIQUE_VIOLATION = '23505'

export class DuplicateSlugError extends Error {}

export interface EntityListItem extends EntitySummary {
  createdAt: Date
  recordCount: number
  fieldCount: number
}

/**
 * HU-ERD-69: lista todos los modulos (entities) del tenant, para la pantalla
 * de administracion "Listado de Modulos" (pages/modulos/index.vue, siguiendo
 * el diseno real de Screen/Listado Modulos en el .pen) - hasta esta HU no
 * existia ningun endpoint de LECTURA sobre entities en si (solo
 * GET /api/entities/:slug/fields, HU-ERD-23, que resuelve una entidad
 * puntual por slug para permisos/campos). Orden alfabetico por nombre, unico
 * criterio razonable sin un campo de orden propio en el schema.
 *
 * Suma recordCount/fieldCount (columnas "Registros"/"Campos" del diseno) con
 * dos queries agrupadas en vez de N+1 por entidad. entity_fields no tiene
 * tenant_id/RLS propio (ver moduleEntityFields.ts) - se filtra explicitamente
 * por los ids de entities ya resueltos para este tenant, no por RLS.
 *
 * Incluye isActive (rediseno "Editar Módulo", ver comentario largo en
 * server/db/schema.ts) para que el badge Activo/Inactivo de la columna
 * "Estado" del listado tenga el dato real, no inventado.
 */
export async function listEntities(tenantId: string): Promise<EntityListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: entities.id,
        slug: entities.slug,
        name: entities.name,
        description: entities.description,
        isActive: entities.isActive,
        icon: entities.icon,
        createdAt: entities.createdAt
      })
      .from(entities)
      .where(eq(entities.tenantId, tenantId))
      .orderBy(entities.name)

    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)

    const recordRows = await tx
      .select({ entityId: records.entityId, value: count() })
      .from(records)
      .where(and(eq(records.tenantId, tenantId), inArray(records.entityId, ids)))
      .groupBy(records.entityId)
    const fieldRows = await tx
      .select({ entityId: entityFields.entityId, value: count() })
      .from(entityFields)
      .where(inArray(entityFields.entityId, ids))
      .groupBy(entityFields.entityId)

    const recordCountByEntity = new Map(recordRows.map((r) => [r.entityId, r.value]))
    const fieldCountByEntity = new Map(fieldRows.map((r) => [r.entityId, r.value]))

    return rows.map((r) => ({
      ...r,
      recordCount: recordCountByEntity.get(r.id) ?? 0,
      fieldCount: fieldCountByEntity.get(r.id) ?? 0
    }))
  })
}

/**
 * Crea un modulo (entity) y le otorga de inmediato permiso CRUD completo al
 * rol Administrador del tenant (roles.isSystem=true, HU-ERD-61) - mismo
 * patron que scripts/seed.mjs (HU-ERD-25): sin esto, el modulo quedaria
 * creado pero inaccesible para cualquier rol, incluido el administrador que
 * lo acaba de crear.
 */
export async function createEntity(
  tenantId: string,
  input: { name: string; slug: string; description: string | null; icon?: string | null }
): Promise<EntitySummary> {
  return withTenant(tenantId, async (tx) => {
    let entity: typeof entities.$inferSelect
    try {
      ;[entity] = await tx
        .insert(entities)
        .values({ tenantId, name: input.name, slug: input.slug, description: input.description, icon: input.icon ?? null })
        .returning()
    } catch (err) {
      // drizzle-orm >=0.36 envuelve el error del driver "postgres" en un
      // DrizzleQueryError propio, dejando el original (con .code = SQLSTATE)
      // en .cause - hay que mirar ahi si err.code no esta presente.
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateSlugError(`Ya existe un modulo con el slug "${input.slug}"`)
      }
      throw err
    }

    const [adminRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.isSystem, true)))
      .limit(1)

    if (adminRole) {
      await tx.insert(roleEntityPermissions).values({
        roleId: adminRole.id,
        entityId: entity.id,
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true
      })
    }

    return {
      id: entity.id,
      slug: entity.slug,
      name: entity.name,
      description: entity.description,
      isActive: entity.isActive,
      icon: entity.icon,
      detailLayout: entity.detailLayout,
      listLayout: entity.listLayout
    }
  })
}

export async function updateEntity(
  tenantId: string,
  entityId: string,
  input: {
    name?: string
    description?: string | null
    isActive?: boolean
    icon?: string | null
    detailLayout?: unknown
    listLayout?: unknown
  }
): Promise<EntitySummary | null> {
  return withTenant(tenantId, async (tx) => {
    const setValues: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) setValues.name = input.name
    if (input.description !== undefined) setValues.description = input.description
    if (input.isActive !== undefined) setValues.isActive = input.isActive
    if (input.icon !== undefined) setValues.icon = input.icon
    if (input.detailLayout !== undefined) setValues.detailLayout = input.detailLayout
    if (input.listLayout !== undefined) setValues.listLayout = input.listLayout

    const [entity] = await tx
      .update(entities)
      .set(setValues)
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)))
      .returning()

    if (!entity) return null
    return {
      id: entity.id,
      slug: entity.slug,
      name: entity.name,
      description: entity.description,
      isActive: entity.isActive,
      icon: entity.icon,
      detailLayout: entity.detailLayout,
      listLayout: entity.listLayout
    }
  })
}

export interface NavEntity {
  id: string
  slug: string
  name: string
  icon: string | null
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

/**
 * ERD-43/ERD-44: entidades visibles para CUALQUIER usuario autenticado (no
 * admin-only como listEntities(), que es la pantalla de administracion de
 * modulos) - para armar el menu dinamico (components/AppNav.vue) sin
 * hardcodear ninguna lista de modulos, y decidir que acciones mostrar en cada
 * uno sin adivinar (mismos 4 flags que getPermissionFlags(), HU-ERD-24).
 *
 * Filtra a role_entity_permissions.can_read = true del rol del usuario -
 * mismo criterio de permiso que requirePermission()/requireAdminRole(). Un
 * modulo desactivado (isActive=false) se excluye tambien para cualquier rol
 * NO administrador, aunque tenga canRead=true, porque igual quedaria
 * bloqueado con 403 al entrar (mismo chequeo que requirePermission()) - no
 * tiene sentido un link de menu que lleva a una pantalla bloqueada. Un
 * administrador (roles.isSystem) sigue viendo el modulo igual, para poder
 * reactivarlo.
 */
export async function listVisibleEntities(tenantId: string, roleId: string): Promise<NavEntity[]> {
  return withTenant(tenantId, async (tx) => {
    const [role] = await tx.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, roleId)).limit(1)
    const isAdmin = Boolean(role?.isSystem)

    const rows = await tx
      .select({
        id: entities.id,
        slug: entities.slug,
        name: entities.name,
        icon: entities.icon,
        isActive: entities.isActive,
        canRead: roleEntityPermissions.canRead,
        canCreate: roleEntityPermissions.canCreate,
        canUpdate: roleEntityPermissions.canUpdate,
        canDelete: roleEntityPermissions.canDelete
      })
      .from(entities)
      .innerJoin(
        roleEntityPermissions,
        and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, roleId))
      )
      .where(and(eq(entities.tenantId, tenantId), eq(roleEntityPermissions.canRead, true)))
      .orderBy(entities.name)

    return rows.filter((r) => isAdmin || r.isActive).map(({ isActive: _isActive, ...rest }) => rest)
  })
}

export type DeleteEntityResult = { status: 'deleted' } | { status: 'has-records'; recordCount: number } | { status: 'not-found' }

/**
 * Elimina un modulo. Bloqueado si tiene records existentes (409 en el
 * endpoint) - nunca borra datos del usuario en cascada. entity_fields y
 * role_entity_permissions SI tienen ON DELETE CASCADE (ERD-6/7/11): metadatos
 * de un modulo vacio se limpian solos, solo los datos cargados por el usuario
 * bloquean el borrado.
 */
export async function deleteEntity(tenantId: string, entityId: string): Promise<DeleteEntityResult> {
  return withTenant(tenantId, async (tx: Tx) => {
    const [entity] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)))
      .limit(1)
    if (!entity) return { status: 'not-found' }

    const [{ value: recordCount }] = await tx
      .select({ value: count() })
      .from(records)
      .where(and(eq(records.entityId, entityId), eq(records.tenantId, tenantId)))

    if (recordCount > 0) {
      return { status: 'has-records', recordCount }
    }

    await tx.delete(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)))
    return { status: 'deleted' }
  })
}
