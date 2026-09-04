import type { EntityFieldMeta } from '~/composables/useEntityFields'

// HU-ERD-72: heuristica pragmatica para la "etiqueta" de un registro
// generico - entity_fields/records no tienen un concepto de "campo
// principal/display". Se usa el valor del PRIMER campo de tipo text de la
// entidad; si no hay ninguno, el id (primeros 8 caracteres). Extraida de
// DynamicTableField.vue (donde nacio, para el chip de una columna de
// relacion) a utils/ en HU-ERD-74 para reusarla tal cual en RecordDetailView.vue
// (encabezado de la ficha de detalle) - mismo criterio que utils/slugify.ts.
//
// Reportado por el usuario (2026-09-03, ver comentario largo en
// server/db/schema.ts): la eleccion automatica ya no es la unica opcion -
// entities.labelField permite fijar a mano cual campo de texto usar como
// etiqueta cuando esta entidad es destino de una relacion. `override` es ese
// valor (entity.labelField, puede venir null/undefined = "sin fijar"). Solo
// se respeta si sigue siendo un campo de texto real y valido de esta
// entidad (nunca "id") - si el campo fue borrado o cambio de tipo despues de
// fijado, se cae a la heuristica automatica en vez de romper el label.
export function labelFieldFor(fields: EntityFieldMeta[], override?: string | null): string | null {
  if (override) {
    const overrideField = fields.find((f) => f.name === override && f.dataType === 'text' && f.name !== 'id')
    if (overrideField) return overrideField.name
  }

  // Reportado por el usuario (2026-09-03): GET /api/entities/:entity/fields
  // ahora siempre antepone un campo sintetico "id" (dataType 'text', ver el
  // comentario largo en fields.get.ts) - sin este filtro, "id" siempre
  // ganaba como "primer campo de tipo text" y esta funcion terminaba
  // devolviendo el mismo fallback truncado de siempre (labelForRecord ya
  // caia a id.slice(0,8) al no encontrar 'id' en customData), tapando
  // cualquier campo real como "nombre" que antes SI se elegia.
  return fields.find((f) => f.dataType === 'text' && f.name !== 'id')?.name ?? null
}

export function labelForRecord(
  fields: EntityFieldMeta[],
  customData: Record<string, unknown>,
  id: string,
  labelFieldOverride?: string | null
): string {
  const labelField = labelFieldFor(fields, labelFieldOverride)
  const raw = labelField ? customData[labelField] : null
  return typeof raw === 'string' && raw.length > 0 ? raw : id.slice(0, 8)
}
