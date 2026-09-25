import { z } from 'zod'

// HU-ERD-75: "Diseño del listado" (Table Builder) - que columnas se muestran
// en DynamicTable.vue y en que orden, que campos filtrables se ofrecen como
// filtro (nunca un campo que el backend no puede filtrar), y el orden por
// defecto de la tabla. Mismo
// patron de reconciliacion que server/utils/detailLayout.ts (ERD-74): sin
// tabla nueva, jsonb en entities.list_layout, resuelto contra los campos
// reales en cada lectura para nunca romper ni quedar desincronizado.

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

const listLayoutColumnSchema = z.object({ name: z.string().min(1), visible: z.boolean() }).strict()
const listLayoutDefaultSortSchema = z.object({ field: z.string().min(1), dir: z.enum(['asc', 'desc']) }).strict()

export const listLayoutSchema = z
  .object({
    columns: z.array(listLayoutColumnSchema),
    filterFields: z.array(z.string().min(1)),
    defaultSort: listLayoutDefaultSortSchema.nullable()
  })
  .strict()

/**
 * Default = comportamiento del listado sin configuración propia: todas las
 * columnas visibles en el orden de entity_fields, todos los campos aceptados
 * por el sistema de filtros ofrecidos, sin orden por defecto
 * propio (la pagina de listado sigue usando createdAt/desc como hasta ahora).
 */
export function defaultListLayout(fieldNames: string[], filterableFieldNames: string[]): ListLayout {
  return {
    columns: fieldNames.map((name) => ({ name, visible: true })),
    filterFields: [...filterableFieldNames],
    defaultSort: null
  }
}

/**
 * Reconciliacion contra los campos reales de hoy, mismo criterio que
 * resolveDetailLayout(): sin layout guardado o con forma invalida, cae al
 * default; con uno guardado, las columnas se comportan como "propiedades" de
 * detailLayout (se descartan las borradas, se suman al final las nuevas como
 * visibles - una columna nueva no debe desaparecer silenciosamente del
 * listado). filterFields es distinto a proposito: es una lista curada
 * explicitamente por el administrador (que campos SE OFRECEN como filtro),
 * no un default expansivo - un campo filtrable nuevo creado despues
 * de guardar el layout NO se agrega solo, pero un campo que dejo de ser
 * dejo de ser filtrable (o se borro) SI se descarta, para cumplir el criterio de
 * aceptacion "nunca un campo que el backend no puede filtrar todavia".
 */
export function resolveListLayout(saved: unknown, fieldNames: string[], filterableFieldNames: string[]): ListLayout {
  const parsed = saved ? listLayoutSchema.safeParse(saved) : null
  if (!parsed || !parsed.success) return defaultListLayout(fieldNames, filterableFieldNames)
  const layout = parsed.data

  const knownNames = new Set(fieldNames)
  const columns = layout.columns.filter((c) => knownNames.has(c.name))
  for (const name of fieldNames) {
    if (!columns.some((c) => c.name === name)) columns.push({ name, visible: true })
  }

  const knownFilterable = new Set(filterableFieldNames)
  const filterFields = layout.filterFields.filter((f) => knownFilterable.has(f))

  const defaultSort = layout.defaultSort && knownNames.has(layout.defaultSort.field) ? layout.defaultSort : null

  return { columns, filterFields, defaultSort }
}
