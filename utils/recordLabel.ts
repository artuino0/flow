import type { EntityFieldMeta } from '~/composables/useEntityFields'

// HU-ERD-72: heuristica pragmatica para la "etiqueta" de un registro
// generico - entity_fields/records no tienen un concepto de "campo
// principal/display". Se usa el valor del PRIMER campo de tipo text de la
// entidad; si no hay ninguno, el id (primeros 8 caracteres). Extraida de
// DynamicTableField.vue (donde nacio, para el chip de una columna de
// relacion) a utils/ en HU-ERD-74 para reusarla tal cual en RecordDetailView.vue
// (encabezado de la ficha de detalle) - mismo criterio que utils/slugify.ts.
export function labelFieldFor(fields: EntityFieldMeta[]): string | null {
  return fields.find((f) => f.dataType === 'text')?.name ?? null
}

export function labelForRecord(fields: EntityFieldMeta[], customData: Record<string, unknown>, id: string): string {
  const labelField = labelFieldFor(fields)
  const raw = labelField ? customData[labelField] : null
  return typeof raw === 'string' && raw.length > 0 ? raw : id.slice(0, 8)
}
