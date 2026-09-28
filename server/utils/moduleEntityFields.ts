import { and, count, eq, sql } from 'drizzle-orm'
import { invalidatesTenantAccess } from '~/server/utils/shortCache'
import { collectFieldRefs, parseExpression } from '~/utils/calcExpression'
import { db, withTenant } from '~/server/db'
import { entities, entityFieldHistory, entityFields, records } from '~/server/db/schema'
import { getValidationRulesSchema, invalidateEntitySchemaCache } from '~/server/utils/dynamicSchema'
import { recordNotDeleted } from '~/server/utils/records'

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
// Reportado por el usuario (2026-09-01): un campo con name="id" ya se podia
// crear sin ningun chequeo (la unica regla era el regex de identificador) y
// su fila en ModuleFieldsCard.vue mostraba editar/eliminar igual que
// cualquier otro campo - aunque no colisiona con records.id en si (los
// valores de entity_fields viven bajo custom_data, un namespace jsonb
// separado, ver comentario en records/[entity]/index.get.ts), sigue siendo
// confuso e inconsistente con la respuesta ya dada al usuario de que "id" es
// implicito/reservado. Se bloquea la creacion (fields.post.ts) y, para un
// campo "id" que ya haya quedado creado antes de este fix, se bloquea tambien
// editarlo/eliminarlo aca - defensa en profundidad ademas de ocultar los
// botones en la UI (ModuleFieldsCard.vue), que por si sola no alcanza si
// alguien pega directo a la API.
export class ProtectedFieldError extends Error {}
// Pedido por el usuario (2026-09-01): "el organizador" (reordenar campos) -
// reorderEntityFields() exige que `order` sea EXACTAMENTE el conjunto de ids
// de campos de la entidad, sin faltantes ni sobrantes ni repetidos (para no
// dejar sortOrder en un estado parcial/inconsistente si el frontend manda
// algo desincronizado, ej. por una pestaña vieja abierta en otra sesion).
export class InvalidFieldOrderError extends Error {}

export interface EntityFieldSummary {
  id: string
  entityId: string
  name: string
  label: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
  isOwnerField: boolean
  sortOrder: number
}

function toSummary(row: typeof entityFields.$inferSelect): EntityFieldSummary {
  return {
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    label: row.label,
    dataType: row.dataType,
    validationRules: row.validationRules,
    isRequired: row.isRequired,
    isOwnerField: row.isOwnerField,
    sortOrder: row.sortOrder
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
      isOwnerField: entityFields.isOwnerField,
      sortOrder: entityFields.sortOrder,
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

    // ERD-87: el aviso de impacto (ERD-76) cuenta solo registros activos -
    // avisar sobre datos que ya estan en la papelera confundiria al usuario.
    const [{ value: affectedRecords }] = await tx
      .select({ value: count() })
      .from(records)
      .where(and(eq(records.entityId, current.entityId), recordNotDeleted, sql`${records.customData} ? ${current.name}`))

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

/**
 * Pedido directo del usuario (2026-09-04): valida `validationRules.prefixSource`
 * de un campo 'incremental' - a diferencia de `assertValidationRules()` de
 * arriba (solo forma, sin consultar la base), esto es validacion CRUZADA: que
 * `relationField` sea de verdad un campo `dataType==='relation'` de ESTA MISMA
 * entidad, que ese campo tenga una entidad relacionada configurada
 * (validationRules.relationEntity, HU-ERD-74), y que `sourceField` sea de verdad
 * un campo `dataType==='text'` de ESA entidad relacionada. Por eso necesita `tx`
 * (no puede vivir en dynamicSchema.ts, que es sincrono y sin acceso a la base) y
 * se llama solo cuando el dataType efectivo es 'incremental', desde dentro de la
 * misma transaccion de createEntityField()/updateEntityField() de abajo. Sin
 * `prefixSource` (incremental "simple"), no hay nada que validar aca.
 */
async function assertIncrementalConfig(tx: Tx, tenantId: string, entityId: string, validationRules: unknown): Promise<void> {
  const rules = (validationRules ?? {}) as {
    prefix?: unknown
    prefixSource?: { relationField?: unknown; sourceField?: unknown }
  }
  // Un campo incremental usa una sola estrategia de prefijo. Evita que una
  // configuracion vieja o una peticion directa haga ambiguo si debe resolver
  // el prefijo desde el catalogo o usar el fijo.
  if (typeof rules.prefix === 'string' && rules.prefix.trim() && rules.prefixSource) {
    throw new InvalidValidationRulesError('Un incremental no puede tener prefijo fijo y prefijo de relación al mismo tiempo')
  }
  if (!rules.prefixSource) return
  const relationField = rules.prefixSource.relationField
  const sourceField = rules.prefixSource.sourceField
  if (typeof relationField !== 'string' || typeof sourceField !== 'string') return // forma ya rechazada por assertValidationRules

  const ownFields = await tx
    .select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
    .from(entityFields)
    .where(eq(entityFields.entityId, entityId))

  const relField = ownFields.find((f) => f.name === relationField)
  if (!relField || relField.dataType !== 'relation') {
    throw new InvalidValidationRulesError(`"${relationField}" no es un campo de tipo Relación de este mismo módulo`)
  }

  const relRules = (relField.validationRules ?? {}) as Record<string, unknown>
  const relationEntitySlug = typeof relRules.relationEntity === 'string' ? relRules.relationEntity : null
  if (!relationEntitySlug) {
    throw new InvalidValidationRulesError(`El campo de relación "${relationField}" todavía no tiene una entidad relacionada configurada`)
  }

  const [targetEntity] = await tx
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.slug, relationEntitySlug)))
    .limit(1)
  if (!targetEntity) {
    throw new InvalidValidationRulesError(`La entidad relacionada "${relationEntitySlug}" no existe`)
  }

  const [sourceFieldRow] = await tx
    .select({ id: entityFields.id })
    .from(entityFields)
    .where(and(eq(entityFields.entityId, targetEntity.id), eq(entityFields.name, sourceField), eq(entityFields.dataType, 'text')))
    .limit(1)
  if (!sourceFieldRow) {
    throw new InvalidValidationRulesError(`"${sourceField}" no es un campo de texto válido de la entidad relacionada`)
  }
}

async function assertCalculatedConfig(
  tx: Tx,
  tenantId: string,
  entityId: string,
  fieldName: string,
  dataType: string,
  validationRules: unknown
): Promise<void> {
  if (dataType !== 'number' && dataType !== 'currency') return
  const rules = (validationRules ?? {}) as Record<string, unknown>
  const calculation = rules.calculation as Record<string, unknown> | undefined
  if (!calculation) return

  const ownFields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
    .from(entityFields).where(eq(entityFields.entityId, entityId))
  const numericNames = new Set(ownFields.filter(field => field.dataType === 'number' || field.dataType === 'currency').map(field => field.name))

  if (calculation.kind === 'expression') {
    let tree
    try { tree = parseExpression(String(calculation.expression ?? '')) } catch (error) {
      throw new InvalidValidationRulesError(`Expresión inválida: ${(error as Error).message}`)
    }
    const usable = new Set(ownFields.filter(field => !['tabla', 'file', 'json', 'multiselect'].includes(field.dataType)).map(field => field.name))
    const refs = [...collectFieldRefs(tree)]
    for (const ref of refs) {
      if (ref === fieldName) throw new InvalidValidationRulesError('Un campo calculado no puede depender de sí mismo')
      if (!usable.has(ref)) throw new InvalidValidationRulesError(`"${ref}" no es un campo de este módulo que se pueda usar en una expresión`)
    }
    // Sin ciclos entre campos calculados (fórmulas y expresiones) de este módulo.
    const graph = new Map<string, string[]>()
    for (const field of ownFields) {
      if (field.name === fieldName) continue
      const own = (field.validationRules ?? {}) as Record<string, unknown>
      const other = own.calculation as Record<string, unknown> | undefined
      if (other?.kind === 'formula') graph.set(field.name, [String(other.leftField), String(other.rightField)])
      else if (other?.kind === 'expression') {
        try { graph.set(field.name, [...collectFieldRefs(parseExpression(String(other.expression)))]) } catch { /* expresión guardada inválida: no aporta dependencias */ }
      }
    }
    graph.set(fieldName, refs)
    const visiting = new Set<string>()
    const done = new Set<string>()
    const visit = (name: string) => {
      if (done.has(name)) return
      if (visiting.has(name)) throw new InvalidValidationRulesError('La expresión crea una dependencia circular entre campos calculados')
      visiting.add(name)
      for (const next of graph.get(name) ?? []) visit(next)
      visiting.delete(name)
      done.add(name)
    }
    visit(fieldName)
    return
  }

  if (calculation.kind === 'formula') {
    for (const operand of [calculation.leftField, calculation.rightField]) {
      if (typeof operand !== 'string' || !numericNames.has(operand)) {
        throw new InvalidValidationRulesError(`"${String(operand)}" no es un campo numérico válido de este módulo`)
      }
      if (operand === fieldName) throw new InvalidValidationRulesError('Un campo calculado no puede depender de sí mismo')
    }
    return
  }

  if (calculation.kind !== 'rollup') return
  const [currentEntity] = await tx.select({ slug: entities.slug }).from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
  const [sourceEntity] = await tx.select({ id: entities.id }).from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.slug, String(calculation.sourceEntity)))).limit(1)
  if (!sourceEntity) throw new InvalidValidationRulesError(`El módulo fuente "${String(calculation.sourceEntity)}" no existe`)

  const sourceFields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
    .from(entityFields).where(eq(entityFields.entityId, sourceEntity.id))
  const relation = sourceFields.find(field => field.name === calculation.relationField && field.dataType === 'relation')
  const relationEntity = ((relation?.validationRules ?? {}) as Record<string, unknown>).relationEntity
  if (!relation || relationEntity !== currentEntity?.slug) {
    throw new InvalidValidationRulesError(`"${String(calculation.relationField)}" debe ser una relación del módulo fuente hacia este módulo`)
  }
  if (calculation.aggregate !== 'count') {
    const valueField = sourceFields.find(field => field.name === calculation.valueField)
    if (!valueField || !['number', 'currency'].includes(valueField.dataType)) {
      throw new InvalidValidationRulesError(`"${String(calculation.valueField)}" no es un campo numérico válido del módulo fuente`)
    }
  }
  const filter = calculation.filter as Record<string, unknown> | undefined
  if (filter) {
    if (!sourceFields.some(field => field.name === filter.field && !['tabla', 'file', 'json', 'multiselect'].includes(field.dataType))) {
      throw new InvalidValidationRulesError(`"${String(filter.field)}" no es un campo válido para filtrar en el módulo fuente`)
    }
    if (!['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(String(filter.operator)) || typeof filter.value !== 'string') {
      throw new InvalidValidationRulesError('El filtro del acumulado no es válido')
    }
  }
}

export async function listEntityFields(tenantId: string, entityId: string): Promise<EntityFieldSummary[]> {
  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, entityId)
    // sortOrder primero ("el organizador", ver comentario en el schema);
    // createdAt como desempate (dos campos nunca deberian compartir
    // sortOrder en la practica, pero createEntityField()/reorderEntityFields()
    // de abajo no lo garantizan con una constraint de base - un desempate
    // estable evita que el orden "salte" sin razon si eso llegara a pasar).
    const rows = await tx.select().from(entityFields).where(eq(entityFields.entityId, entityId)).orderBy(entityFields.sortOrder, entityFields.createdAt)
    return rows.map(toSummary)
  })
}

export interface CreateEntityFieldInput {
  name: string
  label: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
  isOwnerField?: boolean
}

export async function createEntityField(tenantId: string, entityId: string, input: CreateEntityFieldInput, existingTx?: Tx): Promise<EntityFieldSummary> {
  assertValidationRules(input.dataType, input.validationRules)
  if (input.isOwnerField && input.dataType !== 'user') throw new InvalidValidationRulesError('Responsable del registro requiere un campo de tipo Usuario')

  const run = async (tx: Tx) => {
    await assertEntityInTenant(tx, tenantId, entityId)
    if (input.dataType === 'incremental') {
      await assertIncrementalConfig(tx, tenantId, entityId, input.validationRules)
    }
    await assertCalculatedConfig(tx, tenantId, entityId, input.name, input.dataType, input.validationRules)

    // "El organizador" (pedido del usuario, 2026-09-01): un campo nuevo se
    // agrega siempre al final - mismo criterio que detailLayout.properties
    // (ERD-74) y listLayout.columns (ERD-75), que tambien suman un campo
    // nuevo al final de lo ya configurado en vez de al principio.
    const [{ value: maxSortOrder }] = await tx
      .select({ value: sql<number>`coalesce(max(${entityFields.sortOrder}), -1)` })
      .from(entityFields)
      .where(eq(entityFields.entityId, entityId))
    const nextSortOrder = maxSortOrder + 1

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
          isRequired: Boolean(((input.validationRules ?? {}) as Record<string, unknown>).calculation) ? false : input.isRequired,
          isOwnerField: input.isOwnerField ?? false,
          sortOrder: nextSortOrder
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
    if (!existingTx) invalidateEntitySchemaCache(tenantId, entityId)
    return toSummary(row)
  }
  return existingTx ? run(existingTx) : withTenant(tenantId, run)
}

export const createEntityFieldInTx = (tx: Tx, tenantId: string, entityId: string, input: CreateEntityFieldInput) => createEntityField(tenantId, entityId, input, tx)

export interface UpdateEntityFieldInput {
  label?: string
  dataType?: string
  validationRules?: unknown
  isRequired?: boolean
  isOwnerField?: boolean
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
    if (current.name === 'id') {
      throw new ProtectedFieldError('El campo "id" es un identificador reservado del sistema y no se puede editar.')
    }

    const effectiveDataType = input.dataType ?? current.dataType
    const effectiveRules = input.validationRules !== undefined ? input.validationRules : current.validationRules
    if ((input.isOwnerField ?? current.isOwnerField) && effectiveDataType !== 'user') throw new InvalidValidationRulesError('Responsable del registro requiere un campo de tipo Usuario')
    assertValidationRules(effectiveDataType, effectiveRules)
    if (effectiveDataType === 'incremental') {
      await assertIncrementalConfig(tx, tenantId, current.entityId, effectiveRules)
    }
    await assertCalculatedConfig(tx, tenantId, current.entityId, current.name, effectiveDataType, effectiveRules)

    const changesMetadataShape =
      (input.dataType !== undefined && input.dataType !== current.dataType) ||
      (input.validationRules !== undefined && JSON.stringify(input.validationRules) !== JSON.stringify(current.validationRules)) ||
      (input.isRequired !== undefined && input.isRequired !== current.isRequired)
      || (input.isOwnerField !== undefined && input.isOwnerField !== current.isOwnerField)

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
    if (Boolean((effectiveRules as Record<string, unknown> | null)?.calculation)) setValues.isRequired = false
    else if (input.isRequired !== undefined) setValues.isRequired = input.isRequired
    if (input.isOwnerField !== undefined) setValues.isOwnerField = input.isOwnerField

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
export async function deleteEntityField(tenantId: string, fieldId: string, existingTx?: Tx): Promise<DeleteEntityFieldResult> {
  const run = async (tx: Tx) => {
    const current = await findFieldInTenant(tx, tenantId, fieldId)
    if (!current) return 'not-found'
    if (current.name === 'id') {
      throw new ProtectedFieldError('El campo "id" es un identificador reservado del sistema y no se puede eliminar.')
    }

    await tx.delete(entityFields).where(eq(entityFields.id, fieldId))
    if (!existingTx) invalidateEntitySchemaCache(tenantId, current.entityId)
    return 'deleted'
  }
  return existingTx ? run(existingTx) : withTenant(tenantId, run)
}

export const deleteEntityFieldInTx = (tx: Tx, tenantId: string, fieldId: string) => deleteEntityField(tenantId, fieldId, tx)

/**
 * "El organizador" (pedido del usuario, 2026-09-01): guarda un nuevo orden
 * para TODOS los campos de una entidad de una sola vez - `order` es la lista
 * completa de fieldIds en el orden deseado (posicion en el array = nuevo
 * sortOrder, 0-based). Se exige que sea EXACTAMENTE el conjunto de campos
 * existentes (mismo tamaño, sin duplicados, sin ids ajenos) para no dejar
 * sortOrder en un estado parcial si el frontend manda una lista
 * desincronizada (ej. una pestaña vieja con un campo ya borrado en otra).
 *
 * A diferencia de update/deleteEntityField (resueltos por fieldId propio, sin
 * necesitar entityId en la URL - ver comentario largo arriba en este
 * archivo), reordenar SI necesita el entityId explicito: no alcanza con "el
 * campo tal", hace falta saber contra que conjunto completo de campos
 * validar `order`. No se marca entity_field_history ni is_dirty aca - el
 * orden no es parte de la "forma" del campo que esos mecanismos versionan
 * (ver metadataShapeChanged en ModuleFieldsCard.vue), asi que reordenar no
 * afecta la validacion de records existentes.
 */
async function reorderEntityFieldsImpl(tenantId: string, entityId: string, order: string[]): Promise<EntityFieldSummary[]> {
  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, entityId)

    const existing = await tx.select({ id: entityFields.id }).from(entityFields).where(eq(entityFields.entityId, entityId))
    const existingIds = new Set(existing.map((f) => f.id))
    const orderIds = new Set(order)
    if (order.length !== existing.length || orderIds.size !== order.length || !order.every((id) => existingIds.has(id))) {
      throw new InvalidFieldOrderError('El orden debe incluir exactamente los campos actuales del modulo, sin repetidos ni faltantes')
    }

    for (let i = 0; i < order.length; i++) {
      await tx.update(entityFields).set({ sortOrder: i, updatedAt: new Date() }).where(eq(entityFields.id, order[i]))
    }

    const rows = await tx.select().from(entityFields).where(eq(entityFields.entityId, entityId)).orderBy(entityFields.sortOrder, entityFields.createdAt)
    return rows.map(toSummary)
  })
}

// Toda escritura que cambia módulos, campos o permisos invalida los cachés de acceso y metadatos (shortCache.ts).
export const reorderEntityFields = invalidatesTenantAccess(reorderEntityFieldsImpl)
