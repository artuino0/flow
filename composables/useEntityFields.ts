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

export interface EntityPermissions {
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export interface EntityFieldsResponse {
  entity: EntityMeta
  fields: EntityFieldMeta[]
  permissions: EntityPermissions
}

export function useEntityFields(slug: string) {
  // HU-ERD-32: mismo fix que useAuth.ts (HU-ERD-22) y AppNav.vue - en SSR,
  // $fetch/useFetch a una ruta interna no reenvia sola la cookie httpOnly de
  // la request original. Sin esto, una carga dura (F5) de /registros/:entity
  // tira 401 durante el SSR y la pagina queda en el estado de error aunque el
  // usuario si este logueado - bug preexistente de HU-ERD-23/24 que no se
  // notaba navegando por links (SPA), solo con un refresh completo.
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  return useFetch<EntityFieldsResponse>(`/api/entities/${slug}/fields`, {
    key: `entity-fields-${slug}`,
    headers
  })
}
