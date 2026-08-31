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
// realmente usa las reglas lee B". ERD-68 va a sumar 'table'/'select'/
// 'multiselect' aca (y en buildFieldType) - no antes, esta HU no los soporta.
export const KNOWN_DATA_TYPES = ['text', 'number', 'boolean', 'date', 'json', 'relation'] as const
export type KnownDataType = (typeof KNOWN_DATA_TYPES)[number]

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
  relation: z.object({}).strict()
}

/** Devuelve el schema Zod de validationRules para un dataType conocido, o null si no se reconoce. */
export function getValidationRulesSchema(dataType: string): z.ZodTypeAny | null {
  return (VALIDATION_RULES_SCHEMAS as Record<string, z.ZodTypeAny>)[dataType] ?? null
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
