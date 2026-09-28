import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/db'
import { entities, entityFields, records } from '~/server/db/schema'
import { lookupUsers } from '~/server/utils/userField'

// Reportado por el usuario (2026-09-03, viendo Screen/Listado Recepción con
// las columnas "productor"/"cultivo" mostrando el uuid crudo del registro
// relacionado): GET /api/records/:entity (listado) y GET /api/records/:entity/:id
// (detalle) devuelven customData tal cual - un campo "relation" ahi es solo un
// uuid, sin ninguna forma de mostrar algo legible sin una query extra por
// registro relacionado. Se resuelve UNA VEZ del lado del servidor (esta
// funcion), no en cada componente del cliente, para no repetir N fetches por
// fila (DynamicTable.vue ya tiene ese problema resuelto para el campo Tabla
// via DynamicTableField.vue, pero eso es dentro de un solo formulario, no un
// listado de N filas).
//
// Duplica (a proposito, mismo criterio ya establecido entre
// utils/recordLabel.ts del cliente y labelFieldFor() de csvImport.ts) la
// heuristica de "campo etiqueta" - pero ACA ademas respeta entities.labelField
// si esta fijado y sigue siendo un campo real de la entidad destino (ver
// comentario largo en server/db/schema.ts).
//
// Bug reportado por el usuario (2026-09-04): igual que utils/recordLabel.ts,
// esto solo consideraba dataType 'text' - un campo 'incremental' tambien es
// un valor de texto legible en custom_data y no deberia quedar afuera (ver
// el comentario largo de LABEL_CANDIDATE_TYPES en utils/recordLabel.ts).
interface LabelFieldRow {
  name: string
  dataType: string
}

const LABEL_CANDIDATE_TYPES = new Set(['text', 'incremental'])

export function pickLabelField(fields: LabelFieldRow[], override: string | null): string | null {
  if (override) {
    const overrideField = fields.find((f) => f.name === override && LABEL_CANDIDATE_TYPES.has(f.dataType))
    if (overrideField) return overrideField.name
  }
  return fields.find((f) => LABEL_CANDIDATE_TYPES.has(f.dataType))?.name ?? null
}

interface SourceFieldRow {
  name: string
  dataType: string
  validationRules: unknown
}

interface SourceRow {
  customData: unknown
}

/**
 * Devuelve `{ [nombreDeCampoRelation]: { [uuidDelRegistroRelacionado]: etiqueta } }`
 * para todas las columnas de tipo 'relation' de `fields` que aparecen con
 * algun valor en `rows` - pensado para adjuntar como `relationLabels` en la
 * respuesta de GET /api/records/:entity (varias filas) y
 * GET /api/records/:entity/:id (una sola fila envuelta en array), sin repetir
 * la logica en cada endpoint. Una sola query por campo relation distinto
 * (agrupa todos los ids de esa columna en un solo IN), no una por fila.
 */
export async function resolveRelationLabels(
  tx: typeof db,
  tenantId: string,
  fields: SourceFieldRow[],
  rows: SourceRow[]
): Promise<Record<string, Record<string, string>>> {
  const relationFields = fields.filter((f) => f.dataType === 'relation' || f.dataType === 'user')
  if (relationFields.length === 0 || rows.length === 0) return {}

  const result: Record<string, Record<string, string>> = {}
  const entityMetaCache = new Map<string, { id: string; labelField: string | null; fields: LabelFieldRow[] } | null>()

  for (const field of relationFields) {
    if (field.dataType === 'user') {
      const ids = new Set<string>()
      for (const row of rows) {
        const value = ((row.customData ?? {}) as Record<string, unknown>)[field.name]
        for (const id of Array.isArray(value) ? value : [value]) if (typeof id === 'string') ids.add(id)
      }
      const userRows = ids.size ? await lookupUsers(tx, tenantId) : []
      result[field.name] = Object.fromEntries([...ids].map(id => {
        const user = userRows.find(item => item.id === id)
        return [id, user ? `${user.fullName || user.email}${user.isActive ? '' : ' (inactivo)'}` : `${id.slice(0, 8)} (inactivo)`]
      }))
      continue
    }
    const rules = (field.validationRules ?? {}) as Record<string, unknown>
    const relationEntitySlug = typeof rules.relationEntity === 'string' ? rules.relationEntity : null
    if (!relationEntitySlug) continue

    const ids = new Set<string>()
    for (const row of rows) {
      const customData = (row.customData ?? {}) as Record<string, unknown>
      const v = customData[field.name]
      if (typeof v === 'string' && v) ids.add(v)
    }
    if (ids.size === 0) continue

    let meta = entityMetaCache.get(relationEntitySlug)
    if (meta === undefined) {
      const [targetEntity] = await tx
        .select({ id: entities.id, labelField: entities.labelField })
        .from(entities)
        .where(and(eq(entities.tenantId, tenantId), eq(entities.slug, relationEntitySlug)))
        .limit(1)
      if (!targetEntity) {
        meta = null
      } else {
        const targetFields = await tx
          .select({ name: entityFields.name, dataType: entityFields.dataType })
          .from(entityFields)
          .where(eq(entityFields.entityId, targetEntity.id))
        meta = { id: targetEntity.id, labelField: targetEntity.labelField, fields: targetFields }
      }
      entityMetaCache.set(relationEntitySlug, meta)
    }
    if (!meta) continue

    const labelFieldName = pickLabelField(meta.fields, meta.labelField)

    const targetRows = await tx
      .select({ id: records.id, customData: records.customData })
      .from(records)
      .where(and(eq(records.tenantId, tenantId), eq(records.entityId, meta.id), inArray(records.id, [...ids])))

    const map: Record<string, string> = {}
    for (const r of targetRows) {
      const raw = labelFieldName ? (r.customData as Record<string, unknown>)[labelFieldName] : null
      map[r.id] = typeof raw === 'string' && raw.length > 0 ? raw : r.id.slice(0, 8)
    }
    result[field.name] = map
  }

  return result
}
