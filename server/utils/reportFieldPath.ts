import { sql as dsql, eq, inArray, type SQL } from 'drizzle-orm'
import type { db } from '~/server/db'
import { entities, entityFields } from '~/server/db/schema'

// ERD-88 (Diseñador de reportes imprimibles): resolucion de "rutas de campo"
// que atraviesan relaciones MULTI-NIVEL, no solo el primer salto - pedido
// explicito del usuario tras mostrar una consulta real de otro ERP (SQL +
// PDF de "reporte de recepciones") que hace exactamente esto: Recepcion ->
// Camion -> Linea de Transporte es un join de 2 saltos, igual que Producto ->
// Cultivo en el ejemplo de empaque.
//
// FlowERP modela las relaciones entre dos entidades de DOS formas distintas
// (confirmado leyendo dynamicSchema.ts/detailLayout.ts antes de escribir esto -
// relation_definitions/record_relations de ERD-10/19/77 es un grafo genérico
// para la pestaña "Relaciones" de Editar Módulo, y NO es lo que usan los
// campos reales que aparecen en los mocks de Pencil de este diseñador):
//
//   1. Campo 'relation' (FORWARD, 1:1 desde el punto de vista del que lo
//      tiene): custom_data[fieldName] guarda directo el uuid del record
//      relacionado (ver dynamicSchema.ts). Ej. Manifiesto.vehiculo -> Vehiculo.
//   2. Relacion INVERSA (1:N): otra entidad tiene un campo 'relation' que
//      apunta a esta (mismo mecanismo que computeInverseRelations() de
//      detailLayout.ts, ERD-74) - ej. Estiba.manifiesto -> Manifiesto,
//      visto desde Manifiesto como "Estibas empacadas (1:N)".
//
// Este archivo NO reusa computeInverseRelations() (que vuelve a consultar la
// base cada vez) - carga toda la metadata del tenant UNA sola vez
// (loadTenantFieldContext) porque un reporte resuelve muchas rutas de campo
// en la misma ejecucion.

type Tx = typeof db

export class InvalidFieldPathError extends Error {}

export interface EntityFieldMeta {
  entityId: string
  name: string
  label: string
  dataType: string
  validationRules: unknown
}

export interface EntityMeta {
  labelField?: string | null
  id: string
  slug: string
  name: string
}

export interface TenantFieldContext {
  entitiesBySlug: Map<string, EntityMeta>
  entitiesById: Map<string, EntityMeta>
  fieldsByEntityId: Map<string, EntityFieldMeta[]>
}

/** Carga entities + entity_fields del tenant una sola vez (mismo criterio de "cargar todo, resolver en memoria" que computeInverseRelations). */
export async function loadTenantFieldContext(tx: Tx, tenantId: string): Promise<TenantFieldContext> {
  const allEntities = await tx.select({ id: entities.id, slug: entities.slug, name: entities.name, labelField: entities.labelField }).from(entities).where(eq(entities.tenantId, tenantId))
  const entitiesById = new Map(allEntities.map((e) => [e.id, e]))
  const entitiesBySlug = new Map(allEntities.map((e) => [e.slug, e]))

  const fieldsByEntityId = new Map<string, EntityFieldMeta[]>()
  if (allEntities.length > 0) {
    const allFields = await tx
      .select({ entityId: entityFields.entityId, name: entityFields.name, label: entityFields.label, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields)
      .where(inArray(entityFields.entityId, allEntities.map((e) => e.id)))
    for (const f of allFields) {
      const list = fieldsByEntityId.get(f.entityId) ?? []
      list.push(f)
      fieldsByEntityId.set(f.entityId, list)
    }
  }
  return { entitiesBySlug, entitiesById, fieldsByEntityId }
}

function inverseRelationsFor(ctx: TenantFieldContext, targetEntityId: string): { entity: EntityMeta; fieldName: string; label: string }[] {
  const targetEntity = ctx.entitiesById.get(targetEntityId)
  if (!targetEntity) return []
  const out: { entity: EntityMeta; fieldName: string; label: string }[] = []
  for (const [entityId, fields] of ctx.fieldsByEntityId) {
    const entity = ctx.entitiesById.get(entityId)
    if (!entity) continue
    for (const f of fields) {
      if (f.dataType !== 'relation') continue
      const rules = (f.validationRules ?? {}) as { relationEntity?: string }
      if (rules.relationEntity !== targetEntity.slug) continue
      out.push({ entity, fieldName: f.name, label: f.label })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Arbol de campos disponibles (panel izquierdo del Diseñador, Screen/Diseñador
// de reporte imprimible - 3 columnas) - cada branch expandible es un salto
// (forward o inverso), cada leaf un campo real arrastrable.

export interface FieldTreeLeaf {
  type: 'leaf'
  fieldName: string
  label: string
  dataType: string
}

export interface FieldTreeBranch {
  type: 'branch'
  kind: 'forward' | 'inverse'
  fieldName: string // campo 'relation' que origina el salto (en la entidad ACTUAL si es forward, en la entidad DESTINO si es inverse)
  entitySlug: string
  entityName: string
  cardinality: '1:1' | '1:N'
  children: FieldTreeNode[]
}

export type FieldTreeNode = FieldTreeLeaf | FieldTreeBranch

// Tope de profundidad (3 saltos) - suficiente para los casos reales vistos
// (Recepcion->Camion->Linea de Transporte, Manifiesto->Vehiculo->Linea de
// Transporte son 2) y evita recorrer indefinidamente un grafo con ciclos.
export const MAX_FIELD_PATH_DEPTH = 3

/** Arbol de campos/relaciones navegables desde `entityId`, sin volver a la entidad de la que se vino (evita ciclos triviales A->B->A). */
export function buildFieldTree(ctx: TenantFieldContext, entityId: string, cameFromEntityId?: string, depth = 0): FieldTreeNode[] {
  const fields = ctx.fieldsByEntityId.get(entityId) ?? []
  const nodes: FieldTreeNode[] = []

  for (const f of fields.filter((f) => f.dataType !== 'relation')) {
    nodes.push({ type: 'leaf', fieldName: f.name, label: f.label, dataType: f.dataType })
  }

  if (depth < MAX_FIELD_PATH_DEPTH) {
    for (const f of fields.filter((f) => f.dataType === 'relation')) {
      const rules = (f.validationRules ?? {}) as { relationEntity?: string }
      const target = rules.relationEntity ? ctx.entitiesBySlug.get(rules.relationEntity) : undefined
      if (!target || target.id === cameFromEntityId) continue
      nodes.push({
        type: 'branch',
        kind: 'forward',
        fieldName: f.name,
        entitySlug: target.slug,
        entityName: target.name,
        cardinality: '1:1',
        children: buildFieldTree(ctx, target.id, entityId, depth + 1)
      })
    }

    for (const inv of inverseRelationsFor(ctx, entityId)) {
      if (inv.entity.id === cameFromEntityId) continue
      nodes.push({
        type: 'branch',
        kind: 'inverse',
        fieldName: inv.fieldName,
        entitySlug: inv.entity.slug,
        entityName: inv.entity.name,
        cardinality: '1:N',
        children: buildFieldTree(ctx, inv.entity.id, entityId, depth + 1)
      })
    }
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Planificador de joins - traduce una cadena de saltos FORWARD (0 a N campos
// 'relation' encadenados) en LEFT JOINs reales contra records, reusando el
// mismo alias cuando dos columnas piden la misma ruta.
//
// Deliberadamente NO soporta un arbol arbitrario de multiples "tablas
// relacionadas" en un mismo reporte - los 3 mocks reales (Diseñador 3
// columnas / Config de tabla relacionada / Vista previa) muestran siempre UNA
// sola "tabla relacionada" (el detalle 1:N) por reporte, con saltos forward
// adicionales colgando tanto de la entidad base como del detalle para traer
// columnas de un solo valor (ej. Manifiesto->Vehiculo->Linea de Transporte).
// Un reporte con mas de un detalle 1:N queda fuera de alcance de esta HU.

export interface ColumnSource {
  side: 'base' | 'detail'
  forwardHops: string[]
  field: string
}

export class ReportPathPlanner {
  private ctx: TenantFieldContext
  private tenantId: string
  private joins: SQL[] = []
  private aliasCache = new Map<string, string>()
  private counter = 0
  readonly baseEntityId: string
  readonly detailEntityId?: string

  constructor(ctx: TenantFieldContext, tenantId: string, baseEntityId: string, detailEntityId?: string) {
    this.ctx = ctx
    this.tenantId = tenantId
    this.baseEntityId = baseEntityId
    this.detailEntityId = detailEntityId
    this.aliasCache.set('base|', 'r_base')
    if (detailEntityId) this.aliasCache.set('detail|', 'r_detail')
  }

  /** SQL de los LEFT JOINs generados hasta ahora (saltos forward), en orden de creacion. */
  get joinSql(): SQL[] {
    return this.joins
  }

  /** Resuelve (creando los joins que falten) el alias de records donde vive el campo final de `source`, y su metadata. */
  resolve(source: ColumnSource): { alias: string; field: EntityFieldMeta } {
    const startAlias = source.side === 'base' ? 'r_base' : 'r_detail'
    const startEntityId = source.side === 'base' ? this.baseEntityId : this.detailEntityId
    if (!startEntityId) throw new InvalidFieldPathError('Este reporte no tiene tabla relacionada configurada')

    let currentAlias = startAlias
    let currentEntityId = startEntityId
    const pathParts: string[] = []

    for (const fieldName of source.forwardHops) {
      pathParts.push(fieldName)
      const cacheKey = `${source.side}|${pathParts.join('.')}`
      const cached = this.aliasCache.get(cacheKey)
      if (cached) {
        currentAlias = cached
        currentEntityId = this.entityIdForAlias(cached) ?? currentEntityId
        continue
      }

      const field = (this.ctx.fieldsByEntityId.get(currentEntityId) ?? []).find((f) => f.name === fieldName)
      if (!field || field.dataType !== 'relation') {
        throw new InvalidFieldPathError(`"${fieldName}" no es un campo de relación válido en esta ruta`)
      }
      const rules = (field.validationRules ?? {}) as { relationEntity?: string }
      const target = rules.relationEntity ? this.ctx.entitiesBySlug.get(rules.relationEntity) : undefined
      if (!target) throw new InvalidFieldPathError(`"${fieldName}" no tiene una entidad relacionada configurada`)

      // tenant_id explicito en el join ademas de RLS (defensa en profundidad,
      // mismo criterio que reportQuery.ts: RLS via withTenant() ya restringe
      // filas de "records" al tenant activo, pero el codigo del proyecto no
      // depende solo de eso en SQL escrito a mano). Deliberadamente SIN
      // filtro de deleted_at aca: un salto forward resuelve un id de relacion
      // ya conocido (igual que relationLabels.ts/records.ts), y debe seguir
      // trayendo el valor aunque ese record puntual este en la papelera.
      const newAlias = `r${this.counter++}`
      this.joins.push(
        dsql`left join records as ${dsql.raw(newAlias)} on ${dsql.raw(newAlias)}.id = (${dsql.raw(currentAlias)}.custom_data ->> ${fieldName})::uuid and ${dsql.raw(newAlias)}.entity_id = ${target.id} and ${dsql.raw(newAlias)}.tenant_id = ${this.tenantId}`
      )
      this.aliasCache.set(cacheKey, newAlias)
      this.aliasEntityId.set(newAlias, target.id)
      currentAlias = newAlias
      currentEntityId = target.id
    }

    const finalField = (this.ctx.fieldsByEntityId.get(currentEntityId) ?? []).find((f) => f.name === source.field)
    if (!finalField) {
      throw new InvalidFieldPathError(`"${source.field}" no es un campo real de "${this.ctx.entitiesById.get(currentEntityId)?.name ?? currentEntityId}"`)
    }
    return { alias: currentAlias, field: finalField }
  }

  private aliasEntityId = new Map<string, string>()
  private entityIdForAlias(alias: string): string | undefined {
    if (alias === 'r_base') return this.baseEntityId
    if (alias === 'r_detail') return this.detailEntityId
    return this.aliasEntityId.get(alias)
  }

  /** Expresion SQL (texto) del valor final de `source` - custom_data->>'campo' del alias resuelto. */
  valueSql(source: ColumnSource): SQL {
    const { alias, field } = this.resolve(source)
    return dsql`(${dsql.raw(alias)}.custom_data ->> ${field.name})`
  }
}
