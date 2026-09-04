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
  // Reportado por el usuario (2026-09-03, ver comentario largo en
  // server/db/schema.ts): campo propio de texto elegido a mano como
  // etiqueta cuando ESTA entidad es destino de una relacion. null/undefined
  // = heuristica automatica (utils/recordLabel.ts).
  labelField?: string | null
}

export interface EntityPermissions {
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

// HU-ERD-74: "Diseño del detalle" - ver server/utils/detailLayout.ts para la
// logica real (default + reconciliacion). El frontend solo consume el
// resultado YA resuelto (nunca `entity.detailLayout` crudo, que puede ser
// null o estar desactualizado contra los campos/relaciones de hoy).
export interface DetailLayoutProperty {
  name: string
  visible: boolean
}
export interface DetailLayoutRelation {
  entitySlug: string
  fieldName: string
  visible: boolean
}
export interface DetailLayout {
  properties: DetailLayoutProperty[]
  relations: DetailLayoutRelation[]
  showActivity: boolean
}
export interface InverseRelation {
  entitySlug: string
  entityName: string
  fieldName: string
  fieldLabel: string
}

// HU-ERD-75: "Diseño del listado" (Table Builder) - ver server/utils/listLayout.ts
// para la logica real (default + reconciliacion). Mismo criterio que
// DetailLayout: el frontend solo consume el resultado YA resuelto.
export interface ListLayoutColumn {
  name: string
  visible: boolean
}
export interface ListLayoutDefaultSort {
  field: string
  dir: 'asc' | 'desc'
}
export interface ListLayout {
  columns: ListLayoutColumn[]
  filterFields: string[]
  defaultSort: ListLayoutDefaultSort | null
}

export interface EntityFieldsResponse {
  entity: EntityMeta
  fields: EntityFieldMeta[]
  permissions: EntityPermissions
  inverseRelations: InverseRelation[]
  detailLayout: DetailLayout
  listLayout: ListLayout
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
