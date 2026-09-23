import { and, eq, sql } from 'drizzle-orm'
import type { db } from '~/server/db'
import { entityFieldCounters, records } from '~/server/db/schema'

// Pedido directo del usuario (2026-09-04): "quisiera un campo nuevo que sea como
// un incremental... o tal vez un campo incremental que use un campo de una
// relacion para completarse, por ejemplo catalogo mercado, nacional o
// extranjero, y 6 0 con el incremental en los numeros E003902 o N002356".
// dataType 'incremental' (ver KNOWN_DATA_TYPES/buildFieldType en
// dynamicSchema.ts): un correlativo autogenerado, relleno con ceros a la
// izquierda hasta `digits` posiciones, opcionalmente prefijado con el valor de
// un campo de texto de la entidad relacionada por un campo 'relation' propio de
// esta misma entidad. Confirmado con el usuario: (a) un contador INDEPENDIENTE
// por cada valor de prefijo, no uno global compartido; (b) 100% automatico y de
// solo lectura, nunca editable a mano.

type Tx = typeof db

export class MissingIncrementalPrefixError extends Error {}

export interface IncrementalFieldRow {
  id: string
  name: string
  validationRules: unknown
}

interface IncrementalConfig {
  digits: number
  prefix?: string
  prefixSource?: { relationField: string; sourceField: string }
}

/** Misma forma que valida VALIDATION_RULES_SCHEMAS.incremental (dynamicSchema.ts) - digits siempre presente ahi, default 6 solo como red de seguridad si llegara vacio. */
function parseConfig(validationRules: unknown): IncrementalConfig {
  const rules = (validationRules ?? {}) as Record<string, unknown>
  const digits = typeof rules.digits === 'number' && rules.digits >= 1 ? rules.digits : 6
  const prefix = typeof rules.prefix === 'string' && rules.prefix.trim() ? rules.prefix.trim() : undefined
  const raw = rules.prefixSource as { relationField?: unknown; sourceField?: unknown } | undefined
  const prefixSource =
    raw && typeof raw.relationField === 'string' && typeof raw.sourceField === 'string'
      ? { relationField: raw.relationField, sourceField: raw.sourceField }
      : undefined
  return { digits, prefix, prefixSource }
}

/**
 * Resuelve el prefijo real (ej. "N"/"E") a partir del customData que se esta
 * por insertar - necesita el uuid YA ELEGIDO del campo relation
 * (prefixSource.relationField) en ESTE MISMO record para ir a buscar, en el
 * registro relacionado, el valor de prefixSource.sourceField. Si el campo
 * relation todavia no tiene valor (o el registro relacionado no lo tiene
 * completo), no hay forma de saber el prefijo - se corta con un error claro en
 * vez de generar un valor a medias o adivinar.
 */
async function resolvePrefix(
  tx: Tx,
  tenantId: string,
  prefixSource: { relationField: string; sourceField: string },
  customData: Record<string, unknown>
): Promise<string> {
  const relatedId = customData[prefixSource.relationField]
  if (typeof relatedId !== 'string' || !relatedId) {
    throw new MissingIncrementalPrefixError(
      `No se puede generar este campo sin completar antes "${prefixSource.relationField}"`
    )
  }

  const [relatedRecord] = await tx
    .select({ customData: records.customData })
    .from(records)
    .where(and(eq(records.tenantId, tenantId), eq(records.id, relatedId)))
    .limit(1)
  if (!relatedRecord) {
    throw new MissingIncrementalPrefixError(`El registro relacionado por "${prefixSource.relationField}" no existe`)
  }

  const raw = (relatedRecord.customData as Record<string, unknown>)[prefixSource.sourceField]
  if (typeof raw !== 'string' || !raw) {
    throw new MissingIncrementalPrefixError(
      `El registro relacionado por "${prefixSource.relationField}" no tiene un valor en "${prefixSource.sourceField}"`
    )
  }
  return raw
}

/**
 * Incrementa atomicamente el contador de (entityFieldId, prefix) y devuelve el
 * nuevo valor - upsert con `lastValue = lastValue + 1` calculado EN el UPDATE
 * (no leido y reescrito desde JS), dentro de la misma transaccion del insert del
 * record real. Eso es lo que lo hace seguro ante concurrencia: dos inserts
 * simultaneos sobre el mismo prefijo compiten por el lock de fila que Postgres
 * ya toma en un UPDATE/INSERT ON CONFLICT - el segundo espera a que el primero
 * confirme (o revierta) antes de tomar su propio numero, nunca pueden leer el
 * mismo `lastValue` de partida.
 */
async function nextCounterValue(tx: Tx, entityFieldId: string, prefix: string): Promise<number> {
  const [row] = await tx
    .insert(entityFieldCounters)
    .values({ entityFieldId, prefix, lastValue: 1 })
    .onConflictDoUpdate({
      target: [entityFieldCounters.entityFieldId, entityFieldCounters.prefix],
      set: { lastValue: sql`${entityFieldCounters.lastValue} + 1`, updatedAt: new Date() }
    })
    .returning({ lastValue: entityFieldCounters.lastValue })
  return row.lastValue
}

/**
 * Genera el valor final (string) de un campo 'incremental' para un record que
 * se esta por insertar. SIEMPRE se llama dentro de la MISMA transaccion del
 * insert real (server/api/records/[entity]/index.post.ts) - ver el porque en
 * nextCounterValue() de arriba.
 *
 * `customData` es el objeto YA VALIDADO (parsed.data del schema Zod dinamico)
 * que se esta por guardar - se usa de solo-lectura, para resolver el prefijo si
 * corresponde; el resultado se inyecta aparte, en la llamada, bajo la clave
 * field.name.
 */
export async function generateIncrementalValue(
  tx: Tx,
  tenantId: string,
  field: IncrementalFieldRow,
  customData: Record<string, unknown>
): Promise<string> {
  const config = parseConfig(field.validationRules)
  const prefix = config.prefixSource ? await resolvePrefix(tx, tenantId, config.prefixSource, customData) : config.prefix ?? ''
  const value = await nextCounterValue(tx, field.id, prefix)
  // Si el contador supera `digits` (ej. mas de 999999 con digits=6), padStart
  // no trunca - el numero simplemente crece mas alla de lo configurado (mejor
  // que romper o reiniciar en 0, lo que si duplicaria valores ya emitidos).
  return prefix + String(value).padStart(config.digits, '0')
}
