import { and, count, eq, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, entityFieldHistory, entityFields, records } from '~/server/db/schema'
import { getValidationRulesSchema, invalidateEntitySchemaCache } from '~/server/utils/dynamicSchema'

// HU-ERD-67: logica de "campos de un modulo" (entity_fields) como metadatos
// administrables - mismo espiritu que moduleEntities.ts (ERD-66), separada de
// los endpoints para poder testearla sin pasar por HTTP.
//
// entity_fields NO tiene tenant_id propio (ni politica RLS - a diferencia de
// entities/records/roles, ver test/integration/rlsTenantIsolation.test.ts):
// pertenece a una entity, y esa SI es RLS-tenant-scoped. Por eso toda funcion
// de aca resuelve la entity dueña dentro del tenant (por join o chequeo
// directo) ANTES de tocar entity_fields - sin eso, pedir un fieldId ajeno
// filtraria solo por su propio id y listo (fuga entre tenants).
//
// Nota de diseño (desvio del alcance literal de la HU en Jira, documentado):
// el criterio de aceptacion decia "PUT/DELETE /api/entities/:id/fields/:fieldId"
// (anidado bajo la entity, igual que POST). Se probo asi primero y el server
// COMPILADO real (nuxt build) devolvia 404/500 de forma inconsistente: un bug
// real del router de Nitro (rou3) al mezclar, bajo el mismo prefijo de ruta,
// un metodo que TERMINA ahi (GET/POST en .../fields) con otros que CONTINUAN
// con mas segmentos (PUT/DELETE en .../fields/:fieldId) - confirmado
// invirtiendo el orden de registro de archivos y viendo que la ruta rota
// cambiaba segun cual grupo se registraba primero. La correccion real es
// server-framework, no de este codigo; mientras tanto PUT/DELETE se movieron
// a un recurso propio y plano: /api/entity-fields/:fieldId (ver
// server/api/entity-fields/). Por eso update/deleteEntityField ya NO piden
// entityId: resuelven la entity dueña (y su tenant) haciendo join contra
// entities directamente desde el fieldId.

type Tx = typeof db

const PG_UNIQUE_VIOLATION = '23505'

export class DuplicateFieldNameError extends Error {}
export class EntityNotFoundError extends Error {}
export class InvalidValidationRulesError extends Error {}

export interface EntityFieldSummary {
  id: string
  entityId: string
  name: string
  label: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
}

function toSummary(row: typeof entityFields.$inferSelect): EntityFieldSummary {
  return {
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    label: row.label,
    dataType: row.dataType,
    validationRules: row.validationRules,
    isRequired: row.isRequired
  }
}

/** Lanza EntityNotFoundError si la entity no existe o no es del tenant. */
async function assertEntityInTenant(tx: Tx, tenantId: string, entityId: string): Promise<void> {
  const [entity] = await tx
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)))
    .limit(1)
  if (!entity) throw new EntityNotFoundError()
}

/** Busca un campo por su propio id, resolviendo (via join) que su entity dueña sea del tenant. Null si no existe o es de otro tenant. */
async function findFieldInTenant(tx: Tx, tenantId: string, fieldId: string): Promise<typeof entityFields.$inferSelect | null> {
  const [row] = await tx
    .select({
      id: entityFields.id,
      entityId: entityFields.entityId,
      name: entityFields.name,
      label: entityFields.label,
      dataType: entityFields.dataType,
      validationRules: entityFields.validationRules,
      isRequired: entityFields.isRequired,
      createdAt: entityFields.createdAt,
      updatedAt: entityFields.updatedAt
    })
    .from(entityFields)
    .innerJoin(entities, eq(entities.id, entityFields.entityId))
    .where(and(eq(entityFields.id, fieldId), eq(entities.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}

export interface EntityFieldImpact extends EntityFieldSummary {
  affectedRecords: number
}

/**
 * HU-ERD-76: cuenta cuantos records de la entidad dueña de este campo ya
 * tienen una clave para el (en custom_data, jsonb) - usado por el modal de
 * advertencia antes de confirmar una edicion/borrado que puede afectar datos
 * existentes (Screen/Advertencia - Editar Campo con Datos del .pen).
 *
 * El conteo se calcula SIEMPRE server-side (criterio de aceptacion explicito
 * de la HU - "nunca estimado en el frontend") con el operador jsonb `?`
 * ("existe esta clave de nivel superior"), que usa el mismo indice GIN ya
 * existente en records.custom_data (migracion inicial, ERD-9) sin necesidad
 * de un indice nuevo.
 *
 * Expuesta via GET /api/entity-fields/:fieldId (mismo recurso PLANO que
 * PUT/DELETE, HU-ERD-67) a proposito: agregar un GET al mismo path terminal
 * es solo una diferenciacion por verbo HTTP (sin riesgo), a diferencia de
 * agregar un segmento nuevo despues de :fieldId (ej. /api/entity-fields/:fieldId/impact),
 * que hubiera reproducido el bug real de enrutamiento de Nitro/rou3 ya
 * documentado arriba en este archivo (mezclar, bajo el mismo prefijo, un
 * path que TERMINA en :fieldId con otro que CONTINUA con mas segmentos).
 */
export async function getEntityFieldImpact(tenantId: string, fieldId: string): Promise<EntityFieldImpact | null> {
  return withTenant(tenantId, async (tx) => {
    const current = await findFieldInTenant(tx, tenantId, fieldId)
    if (!current) return null

    const [{ value: affectedRecords }] = await tx
      .select({ value: count() })
      .from(records)
      .where(and(eq(records.entityId, current.entityId), sql`${records.customData} ? ${current.name}`))

    return { ...toSummary(current), affectedRecords }
  })
}

/** Valida validationRules contra la forma esperada para dataType (ERD-17: misma fuente de verdad que buildFieldType). */
function assertValidationRules(dataType: string, validationRules: unknown): void {
  const schema = getValidationRulesSchema(dataType)
  if (!schema) {
    throw new InvalidValidationRulesError(`dataType "${dataType}" no es un tipo de dato soportado`)
  }
  const result = schema.safeParse(validationRules ?? {})
  if (!result.success) {
    throw new InvalidValidationRulesError(`validationRules invalido para dataType "${dataType}": ${result.error.message}`)
  }
}

export async function listEntityFields(tenantId: string, entityId: string): Promise<EntityFieldSummary[]> {
  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, entityId)
    const rows = await tx.select().from(entityFields).where(eq(entityFields.entityId, entityId)).orderBy(entityFields.createdAt)
    return rows.map(toSummary)
  })
}

export interface CreateEntityFieldInput {
  name: string
  label: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
}

export async function createEntityField(tenantId: string, entityId: string, input: CreateEntityFieldInput): Promise<EntityFieldSummary> {
  assertValidationRules(input.dataType, input.validationRules)

  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, entityId)

    let row: typeof entityFields.$inferSelect
    try {
      ;[row] = await tx
        .insert(entityFields)
        .values({
          entityId,
          name: input.name,
          label: input.label,
          dataType: input.dataType,
          validationRules: input.validationRules ?? {},
          isRequired: input.isRequired
        })
        .returning()
    } catch (err) {
      // Mismo hallazgo que moduleEntities.ts (ERD-66): drizzle-orm >=0.36
      // envuelve el error del driver en DrizzleQueryError, el codigo real
      // (SQLSTATE) queda en .cause.
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateFieldNameError(`Ya existe un campo con el nombre "${input.name}" en este modulo`)
      }
      throw err
    }

    // No hace falta marcar records.is_dirty aca a mano: el trigger
    // fn_mark_records_dirty_on_field_change (migracion 0011, ERD-18) corre
    // automaticamente en el INSERT de entity_fields.
    invalidateEntitySchemaCache(tenantId, entityId)
    return toSummary(row)
  })
}

export interface UpdateEntityFieldInput {
  label?: string
  dataType?: string
  validationRules?: unknown
  isRequired?: boolean
}

/**
 * Edita un campo (resuelto por su propio id, ver findFieldInTenant). Si el
 * update cambia dataType/validationRules/isRequired, escribe ANTES un
 * snapshot en entity_field_history con como estaba el campo (no el estado
 * nuevo - ese ya queda vigente en entity_fields) - asi el historial
 * reconstruye la linea de tiempo completa. changedBy es el usuario
 * autenticado (auth.sub); puede ser null si el caller no lo tiene.
 *
 * El marcado de records.is_dirty=true para esta entidad ya lo hace el
 * trigger de la migracion 0011 (mismo evento en Postgres, no hace falta
 * replicarlo aca) - ver comentario en createEntityField.
 */
export async function updateEntityField(
  tenantId: string,
  fieldId: string,
  input: UpdateEntityFieldInput,
  changedBy: string | null
): Promise<EntityFieldSummary | null> {
  return withTenant(tenantId, async (tx) => {
    const current = await findFieldInTenant(tx, tenantId, fieldId)
    if (!current) return null

    const effectiveDataType = input.dataType ?? current.dataType
    const effectiveRules = input.validationRules !== undefined ? input.validationRules : current.validationRules
    assertValidationRules(effectiveDataType, effectiveRules)

    const changesMetadataShape =
      (input.dataType !== undefined && input.dataType !== current.dataType) ||
      (input.validationRules !== undefined && JSON.stringify(input.validationRules) !== JSON.stringify(current.validationRules)) ||
      (input.isRequired !== undefined && input.isRequired !== current.isRequired)

    if (changesMetadataShape) {
      await tx.insert(entityFieldHistory).values({
        entityFieldId: current.id,
        dataType: current.dataType,
        validationRules: current.validationRules,
        isRequired: current.isRequired,
        changedBy
      })
    }

    const setValues: Partial<typeof entityFields.$inferInsert> = { updatedAt: new Date() }
    if (input.label !== undefined) setValues.label = input.label
    if (input.dataType !== undefined) setValues.dataType = input.dataType
    if (input.validationRules !== undefined) setValues.validationRules = input.validationRules
    if (input.isRequired !== undefined) setValues.isRequired = input.isRequired

    const [updated] = await tx.update(entityFields).set(setValues).where(eq(entityFields.id, fieldId)).returning()

    invalidateEntitySchemaCache(tenantId, current.entityId)
    return toSummary(updated)
  })
}

export type DeleteEntityFieldResult = 'deleted' | 'not-found'

/**
 * Elimina un campo (resuelto por su propio id, ver findFieldInTenant). A
 * diferencia de deleteEntity() (ERD-66), esto NUNCA se bloquea por datos
 * existentes: los records que ya tenian una clave para este campo en
 * custom_data (JSONB) simplemente quedan con una clave huerfana, que no
 * rompe nada (el schema Zod dinamico es .passthrough()) y se limpia sola en
 * la proxima revalidacion perezosa (is_dirty, ERD-18) - asi lo pide
 * explicitamente el criterio de aceptacion de esta HU.
 */
export async function deleteEntityField(tenantId: string, fieldId: string): Promise<DeleteEntityFieldResult> {
  return withTenant(tenantId, async (tx) => {
    const current = await findFieldInTenant(tx, tenantId, fieldId)
    if (!current) return 'not-found'

    await tx.delete(entityFields).where(eq(entityFields.id, fieldId))
    invalidateEntitySchemaCache(tenantId, current.entityId)
    return 'deleted'
  })
}
