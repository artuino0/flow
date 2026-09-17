// HU-ERD-75: extraido de components/ModuleDetailLayoutCard.vue (HU-ERD-74),
// que ya tenia este mismo mapa duplicado localmente - con un segundo
// consumidor (components/ModuleListLayoutCard.vue) corresponde compartirlo
// (mismo criterio ya aplicado a utils/optionColors.ts en HU-ERD-73, extraido
// de FieldFormModal.vue al aparecer un segundo consumidor). No exportado
// desde ModuleFieldsCard.vue (su TYPE_BADGE es mas rico: icono + color, pensado
// para el picker de tipo de campo) - aca alcanza una etiqueta de texto simple.
export const FIELD_TYPE_LABEL: Record<string, string> = {
  text: 'Texto',
  number: 'Número',
  currency: 'Monto',
  boolean: 'Booleano',
  date: 'Fecha',
  json: 'JSON',
  relation: 'Relación',
  select: 'Select',
  multiselect: 'Multiselect',
  tabla: 'Tabla',
  // Pedido directo del usuario (2026-09-04): "Incremental" - mismo criterio
  // que el resto del mapa (etiqueta de texto simple, sin icono/color propio).
  incremental: 'Incremental'
}

export function fieldTypeLabel(dataType: string | undefined): string {
  if (!dataType) return '?'
  return FIELD_TYPE_LABEL[dataType] ?? dataType
}
