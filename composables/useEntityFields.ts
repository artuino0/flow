// HU-ERD-23: metadatos de una entidad (campos + tipo + reglas), usados por
// el Form Builder (DynamicForm.vue) para saber que renderizar. Consume
// GET /api/entities/:slug/fields (agregado como parte de esta HU).
export interface EntityFieldMeta {
  id: string
  name: string
  label: string
  dataType: string
  validationRules: Record<string, unknown>
  isRequired: boolean
}

export interface EntityMeta {
  id: string
  slug: string
  name: string
}

export interface EntityFieldsResponse {
  entity: EntityMeta
  fields: EntityFieldMeta[]
}

export function useEntityFields(slug: string) {
  return useFetch<EntityFieldsResponse>(`/api/entities/${slug}/fields`, {
    key: `entity-fields-${slug}`
  })
}
