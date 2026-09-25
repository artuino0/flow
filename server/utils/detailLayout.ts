import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/db'
import { entities, entityFields } from '~/server/db/schema'

// HU-ERD-74: "Diseño del detalle" - que propiedades y relaciones inversas se
// muestran en la ficha de un registro, en que orden, y si se muestra la
// linea de tiempo de actividad. Separado de dynamicSchema.ts (que es sobre
// entity_fields/custom_data) porque esto es metadata de PRESENTACION de la
// entidad misma (entities.detail_layout), no de validacion de datos.

type Tx = typeof db

export interface DetailLayoutProperty {
  name: string
  visible: boolean
}

export interface DetailLayoutRelation {
  entitySlug: string
  fieldName: string
  visible: boolean
  /** La ficha permite agregar/editar/quitar registros hijos en línea (líneas o partidas). */
  editable?: boolean
  /** Campos numéricos del módulo hijo cuya suma se muestra al pie de la tabla editable. */
  totals?: string[]
}

export interface DetailLayout {
  properties: DetailLayoutProperty[]
  relations: DetailLayoutRelation[]
  showActivity: boolean
}

const detailLayoutPropertySchema = z.object({ name: z.string().min(1), visible: z.boolean() }).strict()
const detailLayoutRelationSchema = z.object({ entitySlug: z.string().min(1), fieldName: z.string().min(1), visible: z.boolean(), editable: z.boolean().optional(), totals: z.array(z.string().min(1)).max(10).optional() }).strict()

export const detailLayoutSchema = z
  .object({
    properties: z.array(detailLayoutPropertySchema),
    relations: z.array(detailLayoutRelationSchema),
    showActivity: z.boolean()
  })
  .strict()

export interface InverseRelation {
  entitySlug: string
  entityName: string
  fieldName: string
  fieldLabel: string
}

/**
 * Campos tipo "relation" (con relationEntity, HU-ERD-74) de OTRAS entidades
 * del tenant que apuntan a `targetEntitySlug` - ej. si "Facturas" tiene un
 * campo `cliente_id` con relationEntity="cotizaciones", esto devuelve esa
 * relacion para targetEntitySlug="cotizaciones". entity_fields no tiene
 * tenant_id/RLS propio (mismo hallazgo que moduleEntities.ts): se resuelve
 * primero la lista de entidades del tenant, y se filtra por esos ids.
 */
export async function computeInverseRelations(tx: Tx, tenantId: string, targetEntitySlug: string): Promise<InverseRelation[]> {
  const allEntities = await tx
    .select({ id: entities.id, slug: entities.slug, name: entities.name })
    .from(entities)
    .where(eq(entities.tenantId, tenantId))
  if (allEntities.length === 0) return []

  const ids = allEntities.map((e) => e.id)
  const relationFields = await tx
    .select({ entityId: entityFields.entityId, name: entityFields.name, label: entityFields.label, validationRules: entityFields.validationRules })
    .from(entityFields)
    .where(and(inArray(entityFields.entityId, ids), eq(entityFields.dataType, 'relation')))

  const entityById = new Map(allEntities.map((e) => [e.id, e]))
  const out: InverseRelation[] = []
  for (const f of relationFields) {
    const rules = (f.validationRules ?? {}) as Record<string, unknown>
    if (rules.relationEntity !== targetEntitySlug) continue
    const source = entityById.get(f.entityId)
    if (!source) continue
    out.push({ entitySlug: source.slug, entityName: source.name, fieldName: f.name, fieldLabel: f.label })
  }
  return out
}

/** Orden por defecto: todas las propiedades (orden de entity_fields) y todas las relaciones inversas, todo visible, actividad apagada. */
export function defaultDetailLayout(fieldNames: string[], inverseRelations: InverseRelation[]): DetailLayout {
  return {
    properties: fieldNames.map((name) => ({ name, visible: true })),
    relations: inverseRelations.map((r) => ({ entitySlug: r.entitySlug, fieldName: r.fieldName, visible: true })),
    showActivity: false
  }
}

function relationKey(r: { entitySlug: string; fieldName: string }): string {
  return `${r.entitySlug}.${r.fieldName}`
}

/**
 * Resuelve el layout efectivo de una entidad: si `saved` no existe o no
 * tiene forma valida, cae al orden por defecto (criterio de aceptacion
 * explicito de la HU: "no rompe ni queda vacía"). Si existe, se reconcilia
 * contra los campos/relaciones REALES de hoy - una propiedad borrada desde
 * que se guardo el layout se descarta silenciosamente (ya no existe), y una
 * propiedad agregada despues se suma al final como visible (para que un
 * campo nuevo no quede invisible "para siempre" sin que nadie lo note).
 */
export function resolveDetailLayout(saved: unknown, fieldNames: string[], inverseRelations: InverseRelation[]): DetailLayout {
  const parsed = saved ? detailLayoutSchema.safeParse(saved) : null
  if (!parsed || !parsed.success) return defaultDetailLayout(fieldNames, inverseRelations)
  const layout = parsed.data

  const knownNames = new Set(fieldNames)
  const properties = layout.properties.filter((p) => knownNames.has(p.name))
  for (const name of fieldNames) {
    if (!properties.some((p) => p.name === name)) properties.push({ name, visible: true })
  }

  const knownRelKeys = new Set(inverseRelations.map(relationKey))
  const relations = layout.relations.filter((r) => knownRelKeys.has(relationKey(r)))
  for (const r of inverseRelations) {
    if (!relations.some((x) => relationKey(x) === relationKey(r))) relations.push({ entitySlug: r.entitySlug, fieldName: r.fieldName, visible: true })
  }

  return { properties, relations, showActivity: layout.showActivity }
}
