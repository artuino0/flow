import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entityFields } from '~/server/db/schema'

// Generador de schema Zod dinamico desde entity_fields (HU-ERD-17).
// Traduce cada fila de entity_fields (data_type + validation_rules + is_required)
// a un ZodTypeAny y arma un z.object() por entidad, usado para validar
// records.custom_data en los endpoints de records (ERD-16).

export interface EntityFieldRow {
  name: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
}

interface CacheEntry {
  fingerprint: string
  schema: z.ZodTypeAny
}

// Cache en memoria por proceso: clave tenantId:entityId -> ultimo schema
// compilado + huella de los campos que lo generaron. No evita el roundtrip
// a entity_fields (necesario para detectar cambios), pero evita recompilar
// el z.object() en cada request cuando los metadatos no cambiaron.
const cache = new Map<string, CacheEntry>()

function fingerprint(rows: EntityFieldRow[]): string {
  return JSON.stringify(
    rows
      .map((f) => [f.name, f.dataType, f.validationRules, f.isRequired])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  )
}

// HU-ERD-67: tipos de dato conocidos y forma esperada de validationRules por
// tipo - vive aca (no en moduleEntityFields.ts) porque es la MISMA fuente de
// verdad que buildFieldType() de abajo consume; duplicarla en el endpoint de
// escritura hubiera sido el tipico bug de "el validador dice A, el que
// realmente usa las reglas lee B".
//
// HU-ERD-68 suma 'tabla' (array de objetos - lineas de item, ej. Cotizaciones
// con producto/cantidad/precio) y 'select'/'multiselect' (badges de estado),
// segun el diseño de datos de DOCS/Diseno_Pantallas_Faltantes_Fase2.md. Sin
// tablas nuevas: todo vive en validation_rules (jsonb ya existente).
// HU-ERD-78 suma 'file' (adjunto - almacenamiento en disco local, ver
// server/utils/fileStorage.ts) - se guarda como z.string().uuid() en
// custom_data, EXACTO el mismo criterio que 'relation': una referencia (aca,
// al id de la fila en la tabla files) en vez del valor real embebido.
export const KNOWN_DATA_TYPES = ['text', 'number', 'boolean', 'date', 'json', 'relation', 'tabla', 'select', 'multiselect', 'file'] as const
export type KnownDataType = (typeof KNOWN_DATA_TYPES)[number]

// Tipos permitidos para una columna dentro de un campo 'tabla' - deliberadamente
// mas chico que KNOWN_DATA_TYPES (sin json/tabla/select anidados: una columna
// de una fila es un valor simple, no otro campo compuesto).
const TABLE_COLUMN_TYPES = ['text', 'number', 'boolean', 'date', 'relation'] as const
type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number]

const tableColumnSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(TABLE_COLUMN_TYPES),
    // Solo tiene sentido si type === 'relation' - no se fuerza con una union
    // discriminada para no complicar el mensaje de error; queda documentado aca.
    relationEntity: z.string().min(1).optional(),
    // "copiar de <entidad>.<campo> al elegir la fila, una sola vez" (snapshot,
    // ver DOCS/Diseno_Pantallas_Faltantes_Fase2.md "Semantica de copia") - solo
    // metadata para el frontend (ERD-71/72), buildFieldType() de abajo no la usa.
    copyFrom: z.string().min(1).optional(),
    editable: z.boolean().optional(),
    readonly: z.boolean().optional()
  })
  .strict()

const selectOptionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    color: z.string().min(1).optional()
  })
  .strict()

// HU-ERD-71: "value" es la clave que efectivamente se guarda en custom_data
// (z.enum(values), ver buildFieldType() mas abajo) - dos opciones con el
// mismo value harian z.enum([...]) con entradas repetidas (Zod las tolera,
// pero el enum resultante quedaria ambiguo: dos etiquetas distintas
// indistinguibles en los datos guardados). El criterio de aceptacion de la
// HU pide explicitamente rechazar esto.
function hasDuplicateOptionValues(options: unknown): boolean {
  if (!Array.isArray(options)) return false
  const values = (options as Array<{ value?: unknown }>).map((o) => o.value).filter((v): v is string => typeof v === 'string')
  return new Set(values).size !== values.length
}

const selectOptionsSchema = z
  .object({ options: z.array(selectOptionSchema).min(1) })
  .strict()
  .refine((r) => !hasDuplicateOptionValues(r.options), {
    message: 'Hay valores (value) duplicados entre las opciones de este campo',
    path: ['options']
  })

// Mismo razonamiento que las opciones de select/multiselect: el "name" de
// cada columna es la clave del objeto de fila (buildFieldType() de abajo,
// caso 'tabla') - dos columnas con el mismo name harian que la segunda pise
// silenciosamente a la primera en cada fila guardada.
function hasDuplicateColumnNames(columns: unknown): boolean {
  if (!Array.isArray(columns)) return false
  const names = (columns as Array<{ name?: unknown }>).map((c) => c.name).filter((v): v is string => typeof v === 'string')
  return new Set(names).size !== names.length
}

const tableColumnsSchema = z
  .object({ columns: z.array(tableColumnSchema).min(1) })
  .strict()
  .refine((r) => !hasDuplicateColumnNames(r.columns), {
    message: 'Hay columnas con el mismo nombre técnico en este campo',
    path: ['columns']
  })

const VALIDATION_RULES_SCHEMAS: Record<KnownDataType, z.ZodTypeAny> = {
  text: z
    .object({
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      pattern: z.string().optional(),
      enum: z.array(z.string()).min(1).optional()
    })
    .strict(),
  number: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      integer: z.boolean().optional()
    })
    .strict(),
  boolean: z.object({}).strict(),
  date: z
    .object({
      min: z.string().optional(),
      max: z.string().optional()
    })
    .strict(),
  json: z.object({}).strict(),
  // HU-ERD-74: relationEntity (slug de la entidad destino) es opcional y
  // NO afecta buildFieldType() (sigue siendo z.string().uuid() abajo, sin
  // cambios) - solo metadata para: (a) el picker "Entidad relacionada" de
  // FieldFormModal.vue, y (b) calcular las "relaciones inversas" de OTRA
  // entidad (server/utils/detailLayout.ts) para el configurador de Diseño
  // del Detalle. Un campo relation existente sin esto sigue funcionando igual.
  relation: z.object({ relationEntity: z.string().min(1).optional() }).strict(),
  tabla: tableColumnsSchema,
  select: selectOptionsSchema,
  multiselect: selectOptionsSchema,
  // HU-ERD-78: sin reglas propias en esta primera entrega (limite de tamaño
  // y allowlist de mimeType quedan fijos en server/utils/fileStorage.ts, no
  // configurables por campo todavia) - z.object({}).strict() documenta la
  // intencion explicitamente, igual que 'boolean'/'json' de arriba.
  file: z.object({}).strict()
}

/** Devuelve el schema Zod de validationRules para un dataType conocido, o null si no se reconoce. */
export function getValidationRulesSchema(dataType: string): z.ZodTypeAny | null {
  return (VALIDATION_RULES_SCHEMAS as Record<string, z.ZodTypeAny>)[dataType] ?? null
}

/** Tipo base de una columna dentro de un campo 'tabla' (HU-ERD-68) - subset simple, sin min/max/pattern propios. */
function buildColumnType(type: string): z.ZodTypeAny {
  switch (type as TableColumnType) {
    case 'text':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'date':
      return z.coerce.date()
    case 'relation':
      return z.string().uuid()
    default:
      return z.any()
  }
}

/** Extrae los `value` de validationRules.options (select/multiselect, HU-ERD-68). */
function optionValues(rules: Record<string, unknown>): string[] {
  if (!Array.isArray(rules.options)) return []
  return (rules.options as Array<{ value?: unknown }>).map((o) => o.value).filter((v): v is string => typeof v === 'string')
}

// Exportada para HU-ERD-29: permite testear unitariamente la generacion de
// schema Zod desde metadatos, sin necesitar una base de datos.
export function buildFieldType(field: EntityFieldRow): z.ZodTypeAny {
  const rules = (field.validationRules ?? {}) as Record<string, unknown>
  let base: z.ZodTypeAny

  switch (field.dataType) {
    case 'text': {
      if (Array.isArray(rules.enum) && rules.enum.length > 0) {
        base = z.enum(rules.enum as [string, ...string[]])
        break
      }
      let s = z.string()
      if (typeof rules.minLength === 'number') s = s.min(rules.minLength)
      if (typeof rules.maxLength === 'number') s = s.max(rules.maxLength)
      if (typeof rules.pattern === 'string') s = s.regex(new RegExp(rules.pattern))
      base = s
      break
    }
    case 'number': {
      let n = z.number()
      if (typeof rules.min === 'number') n = n.min(rules.min)
      if (typeof rules.max === 'number') n = n.max(rules.max)
      if (rules.integer === true) n = n.int()
      base = n
      break
    }
    case 'boolean':
      base = z.boolean()
      break
    case 'date': {
      let d = z.coerce.date()
      if (typeof rules.min === 'string') d = d.min(new Date(rules.min))
      if (typeof rules.max === 'string') d = d.max(new Date(rules.max))
      base = d
      break
    }
    case 'json':
      base = z.union([z.record(z.any()), z.array(z.any())])
      break
    case 'relation':
      // Referencia a otro record por id. La integridad real (que el tipo del
      // registro destino coincida con el esperado por la relacion) la valida
      // el trigger fn_validate_record_relation (ERD-10) sobre record_relations,
      // no este schema; aca solo se exige forma de uuid.
      base = z.string().uuid()
      break
    case 'file':
      // Referencia a una fila de la tabla files (HU-ERD-78) - mismo criterio
      // que 'relation' de arriba: solo se exige forma de uuid aca, la
      // existencia real y el permiso sobre esa fila los valida
      // GET/DELETE /api/files/:id en el momento de servir/borrar el archivo.
      base = z.string().uuid()
      break
    case 'tabla': {
      // HU-ERD-68: cada fila es un objeto con una clave por columna definida
      // en validationRules.columns, tipado con buildColumnType() (subset de
      // los tipos base, ver TABLE_COLUMN_TYPES). Semantica de snapshot (copyFrom):
      // esto SOLO valida la FORMA final de la fila ya armada - no sabe ni le
      // importa si un valor vino copiado de una relacion o se tipeo a mano;
      // ese comportamiento es del formulario (ERD-71/72), no de este schema.
      const columns = Array.isArray(rules.columns) ? (rules.columns as Array<{ name: string; type: string }>) : []
      const rowShape: Record<string, z.ZodTypeAny> = {}
      for (const col of columns) rowShape[col.name] = buildColumnType(col.type)
      base = z.array(z.object(rowShape))
      break
    }
    case 'select': {
      const values = optionValues(rules)
      base = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()
      break
    }
    case 'multiselect': {
      const values = optionValues(rules)
      base = values.length > 0 ? z.array(z.enum(values as [string, ...string[]])) : z.array(z.string())
      break
    }
    default:
      base = z.any()
  }

  return field.isRequired ? base : base.optional().nullable()
}

/**
 * Devuelve (y cachea) el schema Zod para el custom_data de una entidad,
 * regenerandolo automaticamente si entity_fields cambio desde la ultima vez
 * que se calculo (comparando una huella de nombre/tipo/reglas/requerido).
 */
export async function getEntityZodSchema(tenantId: string, entityId: string): Promise<z.ZodTypeAny> {
  const cacheKey = `${tenantId}:${entityId}`

  const rows = (await withTenant(tenantId, (tx) =>
    tx
      .select({
        name: entityFields.name,
        dataType: entityFields.dataType,
        validationRules: entityFields.validationRules,
        isRequired: entityFields.isRequired
      })
      .from(entityFields)
      .where(eq(entityFields.entityId, entityId))
  )) as EntityFieldRow[]

  const fp = fingerprint(rows)
  const cached = cache.get(cacheKey)
  if (cached && cached.fingerprint === fp) {
    return cached.schema
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const row of rows) shape[row.name] = buildFieldType(row)

  // passthrough: permite claves no definidas todavia en entity_fields (una
  // entidad puede no tener campos configurados aun, o el formulario dinamico
  // puede ir por delante de la definicion) sin romper records existentes.
  const schema = z.object(shape).passthrough()
  cache.set(cacheKey, { fingerprint: fp, schema })
  return schema
}

/** Invalidacion explicita, para cuando un futuro endpoint de gestion de entity_fields los modifique. */
export function invalidateEntitySchemaCache(tenantId: string, entityId: string): void {
  cache.delete(`${tenantId}:${entityId}`)
}
