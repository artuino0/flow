import { and, count, eq, inArray, isNull, isNotNull } from 'drizzle-orm'
import { invalidatesTenantAccess } from '~/server/utils/shortCache'
import { db, withTenant } from '~/server/db'
import { entities, entityFields, records, roleEntityPermissions, roles } from '~/server/db/schema'
import { pluralize } from '~/server/utils/pluralize'
import { recordNotDeleted } from '~/server/utils/records'

// HU-ERD-66: logica de "modulos" (entities) como metadatos administrables -
// hasta ahora entities/entity_fields solo se creaban por scripts/seed.mjs
// (HU-ERD-25) o SQL directo, sin ningun endpoint de escritura. Separada de
// los endpoints (mismo patron que rolePermissions.ts/dashboardMetrics.ts,
// HU-ERD-31/33) para poder testearla sin pasar por HTTP.

type Tx = typeof db

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ERD-86: ver comentario largo en server/db/schema.ts (entities.moduleKind).
export const MODULE_KINDS = ['hecho', 'dimension'] as const
export type ModuleKind = (typeof MODULE_KINDS)[number]

export interface EntitySummary {
  id: string
  slug: string
  name: string
  description: string | null
  // Rediseno "Editar Módulo" (ver comentario largo en server/db/schema.ts) -
  // switch "Módulo activo". true por defecto.
  isActive: boolean
  deletedAt?: Date | null
  // ERD-86: 'hecho' (menu principal) o 'dimension' (Administracion > Catalogos) -
  // ver comentario largo en server/db/schema.ts.
  moduleKind: ModuleKind
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
  boardConfig?: unknown
  calendarConfig?: unknown
  // Reportado por el usuario (2026-09-03, ver comentario largo en
  // server/db/schema.ts): campo propio de tipo texto (por name, nunca "id")
  // que se usa como etiqueta cuando ESTA entidad es destino de una relacion.
  // null = heuristica automatica (utils/recordLabel.ts). No incluido en
  // listEntities() por el mismo motivo que detailLayout/listLayout: el
  // listado de modulos no lo necesita, solo create/updateEntity y
  // fields.get.ts (via requirePermission()).
  labelField?: string | null
  // Pedido directo del usuario (2026-09-05): "Nombre en singular" opcional -
  // ver comentario largo en server/db/schema.ts (entities.singularName). A
  // diferencia de detailLayout/listLayout/labelField, SI se incluye en
  // listEntities() (mismo criterio que description/icon): vive en la misma
  // pestaña "Información general" de Editar Módulo, como un campo de texto
  // mas junto a Nombre/Descripción, no en un configurador aparte.
  singularName?: string | null
  fiscalConfig?: unknown
  labelConfig?: unknown
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
 *
 * ERD-86: moduleKind opcional filtra a 'hecho' (pages/modulos/index.vue) o
 * 'dimension' (pages/catalogos/index.vue, nueva) - mismo endpoint y misma
 * funcion para ambas pantallas, solo cambia el filtro.
 */
export async function listEntities(tenantId: string, moduleKind?: ModuleKind, deleted: 'exclude' | 'only' | 'all' = 'exclude'): Promise<EntityListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: entities.id,
        slug: entities.slug,
        name: entities.name,
        description: entities.description,
        isActive: entities.isActive,
        deletedAt: entities.deletedAt,
        icon: entities.icon,
        moduleKind: entities.moduleKind,
        singularName: entities.singularName,
        fiscalConfig: entities.fiscalConfig,
        labelConfig: entities.labelConfig,
        createdAt: entities.createdAt
      })
      .from(entities)
      .where(and(eq(entities.tenantId, tenantId), moduleKind ? eq(entities.moduleKind, moduleKind) : undefined,
        deleted === 'exclude' ? isNull(entities.deletedAt) : deleted === 'only' ? isNotNull(entities.deletedAt) : undefined))
      .orderBy(entities.name)

    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)

    // ERD-87: el badge de "N registros" del Listado de Módulos cuenta solo
    // activos - un modulo cuyos registros estan todos en la papelera no debe
    // leerse como si siguiera lleno de datos.
    const recordRows = await tx
      .select({ entityId: records.entityId, value: count() })
      .from(records)
      .where(and(eq(records.tenantId, tenantId), inArray(records.entityId, ids), recordNotDeleted))
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
      moduleKind: r.moduleKind as ModuleKind,
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
 *
 * ERD-86: moduleKind default 'hecho' (columna default en el schema) - el
 * asistente de /catalogos manda 'dimension' explicito, el de /modulos no
 * manda nada (usa el default). El usuario nunca lo elige a mano.
 */
async function createEntityImpl(
  tenantId: string,
  input: { name: string; slug: string; description: string | null; icon?: string | null; moduleKind?: ModuleKind; singularName?: string | null },
  existingTx?: Tx
): Promise<EntitySummary> {
  const run = async (tx: Tx) => {
    let entity: typeof entities.$inferSelect
    try {
      ;[entity] = await tx
        .insert(entities)
        .values({
          tenantId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          icon: input.icon ?? null,
          singularName: input.singularName ?? null,
          ...(input.moduleKind ? { moduleKind: input.moduleKind } : {})
        })
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
      deletedAt: entity.deletedAt,
      icon: entity.icon,
      moduleKind: entity.moduleKind as ModuleKind,
      detailLayout: entity.detailLayout,
      listLayout: entity.listLayout,
      boardConfig: entity.boardConfig,
      calendarConfig: entity.calendarConfig,
      labelField: entity.labelField,
      singularName: entity.singularName,
      fiscalConfig: entity.fiscalConfig,
      labelConfig: entity.labelConfig
    }
  }
  return existingTx ? run(existingTx) : withTenant(tenantId, run)
}

async function updateEntityImpl(
  tenantId: string,
  entityId: string,
  input: {
    name?: string
    description?: string | null
    isActive?: boolean
    icon?: string | null
    detailLayout?: unknown
    listLayout?: unknown
    boardConfig?: unknown
    calendarConfig?: unknown
    workflowConfig?: unknown
    labelField?: string | null
    singularName?: string | null
    fiscalConfig?: unknown
    labelConfig?: unknown
  },
  existingTx?: Tx
): Promise<EntitySummary | null> {
  const run = async (tx: Tx) => {
    const setValues: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) setValues.name = input.name
    if (input.description !== undefined) setValues.description = input.description
    if (input.isActive !== undefined) setValues.isActive = input.isActive
    if (input.icon !== undefined) setValues.icon = input.icon
    if (input.detailLayout !== undefined) setValues.detailLayout = input.detailLayout
    if (input.listLayout !== undefined) setValues.listLayout = input.listLayout
    if (input.boardConfig !== undefined) setValues.boardConfig = input.boardConfig
    if (input.calendarConfig !== undefined) setValues.calendarConfig = input.calendarConfig
    if (input.workflowConfig !== undefined) setValues.workflowConfig = input.workflowConfig
    if (input.labelField !== undefined) setValues.labelField = input.labelField
    if (input.singularName !== undefined) setValues.singularName = input.singularName
    if (input.fiscalConfig !== undefined) setValues.fiscalConfig = input.fiscalConfig
    if (input.labelConfig !== undefined) setValues.labelConfig = input.labelConfig

    const [entity] = await tx
      .update(entities)
      .set(setValues)
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId), isNull(entities.deletedAt)))
      .returning()

    if (!entity) return null
    return {
      id: entity.id,
      slug: entity.slug,
      name: entity.name,
      description: entity.description,
      isActive: entity.isActive,
      deletedAt: entity.deletedAt,
      icon: entity.icon,
      moduleKind: entity.moduleKind as ModuleKind,
      detailLayout: entity.detailLayout,
      listLayout: entity.listLayout,
      calendarConfig: entity.calendarConfig,
      labelField: entity.labelField,
      singularName: entity.singularName,
      fiscalConfig: entity.fiscalConfig,
      labelConfig: entity.labelConfig
    }
  }
  return existingTx ? run(existingTx) : withTenant(tenantId, run)
}

export interface NavEntity {
  id: string
  slug: string
  // Pedido directo del usuario (2026-09-05): "queria que con js en el menu
  // se pusiera en plural, no queria un campo nuevo" - este `name` YA es el
  // que se muestra en el menu (components/AppNav.vue lo usa tal cual), pero
  // ahora, si el modulo tiene `singularName` cargado, es pluralize(singularName)
  // (server/utils/pluralize.ts) en vez del `entities.name` crudo - ver el
  // calculo en listVisibleEntities() de abajo. Sin singularName, sigue siendo
  // exactamente `entities.name`, comportamiento identico al de siempre.
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
 * Solo incluye módulos activos en el menú. Los módulos apagados conservan
 * acceso de lectura por URL para consultar datos históricos.
 *
 * moduleKind es opcional. El menú por áreas consulta ambos tipos para
 * incorporar catálogos contextuales. Devuelve entidades legibles aunque
 * showInMenu sea false; buildNavigation aplica la preferencia de menú.
 */
export async function listVisibleEntities(tenantId: string, roleId: string, moduleKind?: ModuleKind) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: entities.id,
        slug: entities.slug,
        name: entities.name,
        singularName: entities.singularName,
        icon: entities.icon,
        isActive: entities.isActive,
        deletedAt: entities.deletedAt,
        moduleKind: entities.moduleKind,
        showInMenu: roleEntityPermissions.showInMenu,
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
      .where(and(eq(entities.tenantId, tenantId), eq(entities.isActive, true), isNull(entities.deletedAt), eq(roleEntityPermissions.canRead, true), moduleKind ? eq(entities.moduleKind, moduleKind) : undefined))
      .orderBy(entities.name)

    return rows
      .map(({ isActive: _isActive, deletedAt: _deletedAt, singularName, name, ...rest }) => ({
        ...rest,
        name: singularName ? pluralize(singularName) : name
      }))
  })
}

export type DeleteEntityResult = { status: 'deleted' } | { status: 'not-found' }

/**
 * Envía un módulo a la papelera sin borrar metadatos ni registros.
 */
async function deleteEntityImpl(tenantId: string, entityId: string, existingTx?: Tx): Promise<DeleteEntityResult> {
  const run = async (tx: Tx): Promise<DeleteEntityResult> => {
    const [entity] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)))
      .limit(1)
    if (!entity) return { status: 'not-found' }

    await tx.update(entities).set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId), isNull(entities.deletedAt)))
    return { status: 'deleted' }
  }
  return existingTx ? run(existingTx) : withTenant(tenantId, run)
}

async function restoreEntityImpl(tenantId: string, entityId: string): Promise<EntitySummary | null> {
  return withTenant(tenantId, async (tx) => {
    const [entity] = await tx.update(entities)
      .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId), isNotNull(entities.deletedAt)))
      .returning()
    return entity ? { ...entity, moduleKind: entity.moduleKind as ModuleKind } : null
  })
}

// HU-ERD-104c: lectura de un módulo por id (incluido si está borrado) para que
// restore.post.ts pueda revisar moduleKind/deletedAt ANTES de restaurar -
// restoreEntity solo devuelve el módulo ya restaurado (demasiado tarde para
// decidir si consumir cuota de 'modules').
export async function getEntityRecord(tenantId: string, entityId: string) {
  return withTenant(tenantId, async (tx) => {
    const [entity] = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)))
      .limit(1)
    return entity ?? null
  })
}

// Toda escritura que cambia módulos, campos o permisos invalida los cachés de acceso y metadatos (shortCache.ts).
export const createEntity = invalidatesTenantAccess(createEntityImpl)
export const updateEntity = invalidatesTenantAccess(updateEntityImpl)
// Las variantes transaccionales difieren la invalidación hasta que confirme la transacción exterior.
export const createEntityInTx = (tx: Tx, tenantId: string, input: Parameters<typeof createEntityImpl>[1]) => createEntityImpl(tenantId, input, tx)
export const updateEntityInTx = (tx: Tx, tenantId: string, entityId: string, input: Parameters<typeof updateEntityImpl>[2]) => updateEntityImpl(tenantId, entityId, input, tx)
export const deleteEntity = invalidatesTenantAccess(deleteEntityImpl)
export const deleteEntityInTx = (tx: Tx, tenantId: string, entityId: string) => deleteEntityImpl(tenantId, entityId, tx)
export const restoreEntity = invalidatesTenantAccess(restoreEntityImpl)
