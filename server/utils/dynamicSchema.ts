import { z } from 'zod'
import { cachedTenantMetadata, invalidateTenantAccess } from '~/server/utils/shortCache'
import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { upgradeAgendaStaffField } from './agendaStaffField'
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
//
// 'incremental' (pedido directo del usuario, 2026-09-04): un numero correlativo
// autogenerado, relleno con ceros a la izquierda hasta `digits` posiciones (ej.
// 6 digitos: "003902"), opcionalmente con un prefijo de texto sacado de un campo
// de la entidad relacionada por otro campo 'relation' propio (ej. "E003902" /
// "N002356" - Mercado Nacional/Extranjero). El VALOR nunca lo escribe el usuario
// ni llega en el body de POST/PUT /api/records/:entity - se genera server-side
// (server/utils/incrementalField.ts) exactamente igual de intocable que el "id"
// sintetico (ver fields.get.ts), pero a diferencia de "id" SI es una fila real de
// entity_fields (necesita guardar su propia configuracion: digits/prefixSource).
import { DATA_TYPES, applyFieldDefaults } from '~/server/utils/fieldValidations/registry'
export const KNOWN_DATA_TYPES = DATA_TYPES
export type KnownDataType = (typeof KNOWN_DATA_TYPES)[number]

// Tipos permitidos para una columna dentro de un campo 'tabla' - deliberadamente
// mas chico que KNOWN_DATA_TYPES (sin json/tabla/select anidados: una columna
// de una fila es un valor simple, no otro campo compuesto).
export { registryRulesSchema as getValidationRulesSchema, registryFieldType as buildFieldType } from '~/server/utils/fieldValidations/registry'
import { buildRecordSchema } from '~/server/utils/fieldValidations/registry'
import { tenants } from '~/server/db/schema'

/**
 * Devuelve (y cachea) el schema Zod para el custom_data de una entidad,
 * regenerandolo automaticamente si entity_fields cambio desde la ultima vez
 * que se calculo (comparando una huella de nombre/tipo/reglas/requerido).
 */
export async function getEntityZodSchema(tenantId: string, entityId: string, creation?: { userId?: string }): Promise<z.ZodTypeAny> {
  const cacheKey = `${tenantId}:${entityId}:${creation ? `create:${creation.userId ?? ""}` : "validate"}`

  const { rows, timezone } = await cachedTenantMetadata(tenantId, `schema-fields:${entityId}`, () => withTenant(tenantId, async tx => {
    await upgradeAgendaStaffField(tx, tenantId, entityId)
    const rows = await tx
      .select({
        name: entityFields.name,
        dataType: entityFields.dataType,
        validationRules: entityFields.validationRules,
        isRequired: entityFields.isRequired
      })
      .from(entityFields)
      .where(eq(entityFields.entityId, entityId))
    const [organization] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    return { rows, timezone: organization?.timezone ?? 'America/Mexico_City' }
  }))
  const fp = fingerprint(rows) + timezone
  const cached = cache.get(cacheKey)
  if (cached && cached.fingerprint === fp) {
    return cached.schema
  }


  // passthrough: permite claves no definidas todavia en entity_fields (una
  // entidad puede no tener campos configurados aun, o el formulario dinamico
  // puede ir por delante de la definicion) sin romper records existentes.
  const recordSchema = buildRecordSchema(rows, { timezone })
  const schema = creation ? z.preprocess(input => input && typeof input === "object" && !Array.isArray(input) ? applyFieldDefaults(rows, input as Record<string, unknown>, { timezone, userId: creation.userId }) : input, recordSchema) : recordSchema
  cache.set(cacheKey, { fingerprint: fp, schema })
  return schema
}

/** Invalidacion explicita, para cuando un futuro endpoint de gestion de entity_fields los modifique. */
export function invalidateEntitySchemaCache(tenantId: string, entityId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}:${entityId}:`)) cache.delete(key)
  // Un cambio de campos también cambia la definición del módulo que se guarda en memoria unos segundos.
  invalidateTenantAccess(tenantId)
}
