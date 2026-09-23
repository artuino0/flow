import { z } from 'zod'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, entityFields, triggerActions, triggerLogs, triggers } from '~/server/db/schema'
import { collectConditionFields, conditionNodeSchema, type ConditionNode } from '~/server/utils/triggers'
import { emailConfigSchema, notificationConfigSchema, retryTriggerLog, updateFieldConfigSchema, upsertRecordConfigSchema, webhookConfigSchema } from '~/server/utils/triggerActions'

// HU-ERD-51: UI de administracion de triggers - hasta esta HU (ERD-47 a
// ERD-50), triggers/trigger_actions/trigger_logs solo podian tocarse por SQL
// crudo (asi es como los escribe toda la suite de tests de ERD-47/48/49/50).
// Esta capa es la primera forma real de crear/editar/borrar un trigger o sus
// acciones desde afuera de un test. Mismo patron que relationDefinitions.ts
// (HU-ERD-77): logica separada de los endpoints para poder testearla sin
// HTTP, admin-only (definir automatizaciones es configuracion de la
// plataforma, no una accion de uso diario - mismo criterio que
// relation_definitions/entities/entity_fields).

type Tx = typeof db

export class TriggerEntityNotFoundError extends Error {}
export class TriggerNotFoundError extends Error {}
export class TriggerActionNotFoundError extends Error {}
export class TriggerLogNotFoundError extends Error {}
export class InvalidTriggerConditionError extends Error {}
export class InvalidTriggerActionConfigError extends Error {}
export class InvalidTriggerActionOrderError extends Error {}

// Eventos realmente disparados hoy por server/api/records/[entity]/*.ts
// (ERD-16/48). 'on_transition' existe como TriggerEventName desde ERD-47/48
// (la union de tipos ya lo contempla) pero es ERD-53, todavia sin ningun
// endpoint que lo dispare - un trigger creado con ese evento hoy nunca
// dispararia, asi que la UI de administracion (y esta validacion) lo
// restringen a los tres ya implementados hasta que ERD-53 exista.
export const ADMIN_TRIGGER_EVENTS = ['on_create', 'on_update', 'on_delete'] as const
export type AdminTriggerEvent = (typeof ADMIN_TRIGGER_EVENTS)[number]

export const TRIGGER_ACTION_TYPES = ['webhook', 'email', 'notification', 'update_field', 'upsert_record'] as const
export type TriggerActionType = (typeof TRIGGER_ACTION_TYPES)[number]

// Una condicion "sin configurar todavia" ({} , el default de la columna) es
// un estado valido para GUARDAR (el constructor visual del frontend puede
// arrancar vacio) aunque evaluateTriggersForRecord() (ERD-48) la trate como
// invalida al momento de evaluar - dos preocupaciones distintas: "es una
// condicion completa y evaluable" vs "es una forma aceptable para persistir
// mientras se configura". Cualquier otra forma que no sea ni {} ni un
// conditionNodeSchema valido SI se rechaza aca - esa solo podria venir de un
// bug o de saltarse el constructor visual (nunca del uso normal de la UI).
const emptyConditionSchema = z.object({}).strict()
const triggerConditionSchema = z.union([emptyConditionSchema, conditionNodeSchema])

async function assertEntityInTenant(tx: Tx, tenantId: string, entityId: string): Promise<void> {
  const [row] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
  if (!row) throw new TriggerEntityNotFoundError(`La entidad ${entityId} no existe en este tenant`)
}

function validateActionConfig(actionType: string, config: unknown): void {
  const schema = actionType === 'webhook'
    ? webhookConfigSchema
    : actionType === 'email'
      ? emailConfigSchema
      : actionType === 'notification'
        ? notificationConfigSchema
        : actionType === 'upsert_record'
          ? upsertRecordConfigSchema
          : updateFieldConfigSchema
  const parsed = schema.safeParse(config)
  if (!parsed.success) {
    throw new InvalidTriggerActionConfigError(`Configuración inválida para la acción "${actionType}": ${JSON.stringify(parsed.error.flatten().fieldErrors)}`)
  }
  const branch = (config as { branch?: unknown } | null)?.branch
  if (branch !== undefined && branch !== 'yes' && branch !== 'no') {
    throw new InvalidTriggerActionConfigError('La rama de una acción debe ser Sí cumple o No cumple.')
  }
}

export interface TriggerListItem {
  id: string
  name: string
  entityId: string
  entitySlug: string
  entityName: string
  triggerEvent: string
  isActive: boolean
  actionsCount: number
  // Status del ultimo trigger_logs de este trigger (success/failed/retrying/
  // dead_letter), o null si todavia nunca se disparo - columna "Ultima
  // ejecucion" del listado (Screen/Triggers del .pen). Resuelto en JS a
  // partir de TODOS los logs de los triggers listados, ordenados por
  // created_at desc, quedandonos con la primera ocurrencia por triggerId -
  // mismo criterio de simplicidad que actionsCount de arriba, sin necesitar
  // un "distinct on" de Postgres para un listado de tamano modesto.
  lastLogStatus: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Lista triggers del tenant, con el nombre/slug de la entidad ya resuelto y
 * cuantas trigger_actions tiene cada uno (para que el listado no necesite una
 * segunda llamada solo para saber si un trigger esta "vacio"). `entityId`
 * opcional filtra al trigger de una sola entidad (pestaña de administracion
 * de un modulo puntual); sin el, lista todo el tenant.
 */
export async function listTriggers(tenantId: string, entityId?: string): Promise<TriggerListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const conditions = [eq(triggers.tenantId, tenantId)]
    if (entityId) conditions.push(eq(triggers.entityId, entityId))

    const rows = await tx
      .select({
        id: triggers.id,
        name: triggers.name,
        entityId: triggers.entityId,
        entitySlug: entities.slug,
        entityName: entities.name,
        triggerEvent: triggers.triggerEvent,
        isActive: triggers.isActive,
        createdAt: triggers.createdAt,
        updatedAt: triggers.updatedAt
      })
      .from(triggers)
      .innerJoin(entities, eq(entities.id, triggers.entityId))
      .where(and(...conditions))
      .orderBy(desc(triggers.createdAt))

    if (rows.length === 0) return []

    const actionCountRows = await tx
      .select({ triggerId: triggerActions.triggerId, value: count() })
      .from(triggerActions)
      .where(
        inArray(
          triggerActions.triggerId,
          rows.map((r) => r.id)
        )
      )
      .groupBy(triggerActions.triggerId)
    const actionsCountByTrigger = new Map(actionCountRows.map((r) => [r.triggerId, r.value]))

    const logRows = await tx
      .select({ triggerId: triggerLogs.triggerId, status: triggerLogs.status, createdAt: triggerLogs.createdAt })
      .from(triggerLogs)
      .where(
        inArray(
          triggerLogs.triggerId,
          rows.map((r) => r.id)
        )
      )
      .orderBy(desc(triggerLogs.createdAt))
    const lastStatusByTrigger = new Map<string, string>()
    for (const log of logRows) {
      if (!lastStatusByTrigger.has(log.triggerId)) lastStatusByTrigger.set(log.triggerId, log.status)
    }

    return rows.map((r) => ({
      ...r,
      actionsCount: actionsCountByTrigger.get(r.id) ?? 0,
      lastLogStatus: lastStatusByTrigger.get(r.id) ?? null
    }))
  })
}

export interface TriggerActionItem {
  id: string
  actionType: string
  config: unknown
  executionOrder: number
}

export interface TriggerDetail {
  id: string
  name: string
  entityId: string
  entitySlug: string
  entityName: string
  triggerEvent: string
  condition: unknown
  decisionCondition: unknown
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  actions: TriggerActionItem[]
}

// Version "con transaccion ya abierta" de getTrigger - existe para que
// createTrigger()/updateTrigger() puedan releer el detalle recien
// escrito SIN abrir una transaccion nueva. Llamar a withTenant() (que abre
// su PROPIA transaccion/conexion) desde ADENTRO de otro callback de
// withTenant() ya en curso es un bug real, no solo un desprolijidad: el
// insert/update de la transaccion externa todavia no esta comiteado, asi que
// la transaccion interna (una conexion distinta del pool) no lo ve - el
// sintoma exacto que aparecio en test/integration/triggerAdmin.test.ts
// (createTrigger devolvia null, updateTrigger devolvia los datos VIEJOS).
async function getTriggerWithTx(tx: Tx, tenantId: string, id: string): Promise<TriggerDetail | null> {
  const [row] = await tx
    .select({
      id: triggers.id,
      name: triggers.name,
      entityId: triggers.entityId,
      entitySlug: entities.slug,
      entityName: entities.name,
      triggerEvent: triggers.triggerEvent,
      condition: triggers.condition,
      decisionCondition: triggers.decisionCondition,
      isActive: triggers.isActive,
      createdAt: triggers.createdAt,
      updatedAt: triggers.updatedAt
    })
    .from(triggers)
    .innerJoin(entities, eq(entities.id, triggers.entityId))
    .where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId)))
    .limit(1)
  if (!row) return null

  const actions = await tx
    .select({ id: triggerActions.id, actionType: triggerActions.actionType, config: triggerActions.config, executionOrder: triggerActions.executionOrder })
    .from(triggerActions)
    .where(eq(triggerActions.triggerId, id))
    .orderBy(asc(triggerActions.executionOrder))

  return { ...row, actions }
}

/** Detalle completo de un trigger (para el editor) con sus acciones ya ordenadas por execution_order. */
export async function getTrigger(tenantId: string, id: string): Promise<TriggerDetail | null> {
  return withTenant(tenantId, (tx) => getTriggerWithTx(tx, tenantId, id))
}

export interface CreateTriggerInput {
  entityId: string
  name: string
  triggerEvent: AdminTriggerEvent
  condition?: unknown
  decisionCondition?: unknown
}

/**
 * Crea un trigger "en blanco" (sin acciones todavia - se agregan aparte via
 * createTriggerAction) inactivo hasta que el usuario lo active. La entidad debe
 * existir en el tenant; la condicion, si viene, debe ser un
 * conditionNodeSchema valido o {} (sin configurar todavia, ver comentario de
 * triggerConditionSchema arriba).
 */
export async function createTrigger(tenantId: string, input: CreateTriggerInput): Promise<TriggerDetail> {
  const condition = triggerConditionSchema.safeParse(input.condition ?? {})
  const decisionCondition = triggerConditionSchema.safeParse(input.decisionCondition ?? {})
  if (!condition.success) {
    throw new InvalidTriggerConditionError('La condición no tiene una forma válida (revisa el constructor de campo/operador/valor)')
  }
  if (!decisionCondition.success) throw new InvalidTriggerConditionError('La decisión no tiene una forma válida.')

  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, input.entityId)

    const [created] = await tx
      .insert(triggers)
      .values({ tenantId, entityId: input.entityId, name: input.name, triggerEvent: input.triggerEvent, condition: condition.data, decisionCondition: decisionCondition.data, isActive: false })
      .returning({ id: triggers.id })

    const detail = await getTriggerWithTx(tx, tenantId, created.id)
    return detail!
  })
}

export interface UpdateTriggerInput {
  name?: string
  triggerEvent?: AdminTriggerEvent
  condition?: unknown
  decisionCondition?: unknown
  isActive?: boolean
}

/**
 * Actualiza campos parciales de un trigger - incluye isActive, asi que este
 * mismo endpoint es el toggle activo/inactivo del listado (criterio de
 * aceptacion de ERD-51), sin necesitar una ruta separada. entityId
 * deliberadamente NO es editable (mismo criterio que
 * relationDefinitions.updateRelationDefinition() con sourceEntityId/
 * targetEntityId): cambiar a que entidad apunta un trigger ya configurado
 * dejaria su condicion referenciando campos de otra entidad - el camino
 * correcto es borrarlo y crear uno nuevo sobre la entidad correcta.
 */
export async function updateTrigger(tenantId: string, id: string, input: UpdateTriggerInput): Promise<TriggerDetail | null> {
  let condition: unknown | undefined
  if (input.condition !== undefined) {
    const parsed = triggerConditionSchema.safeParse(input.condition)
    if (!parsed.success) {
      throw new InvalidTriggerConditionError('La condición no tiene una forma válida (revisa el constructor de campo/operador/valor)')
    }
    condition = parsed.data
  }
  let decisionCondition: unknown | undefined
  if (input.decisionCondition !== undefined) {
    const parsed = triggerConditionSchema.safeParse(input.decisionCondition)
    if (!parsed.success) throw new InvalidTriggerConditionError('La decisión no tiene una forma válida.')
    decisionCondition = parsed.data
  }

  return withTenant(tenantId, async (tx) => {
    const patch: Partial<typeof triggers.$inferInsert> = { updatedAt: new Date() }
    const current = await getTriggerWithTx(tx, tenantId, id)
    if (!current) return null
    if (input.isActive ?? current.isActive) {
      const parsed = conditionNodeSchema.safeParse(condition ?? current.condition)
      if (!parsed.success) throw new InvalidTriggerConditionError('Configura las condiciones o selecciona todos los registros antes de activar.')
      const fields = await tx.select({ name: entityFields.name }).from(entityFields).where(eq(entityFields.entityId, current.entityId))
      const names = new Set(fields.map(f => f.name))
      if (collectConditionFields(parsed.data).some(field => !names.has(field))) throw new InvalidTriggerConditionError('Una condición hace referencia a un campo que ya no existe.')
      const hasChanged = (node: ConditionNode): boolean => 'field' in node ? node.operator === 'changed' : 'and' in node ? node.and.some(hasChanged) : 'or' in node ? node.or.some(hasChanged) : false
      if (hasChanged(parsed.data) && (input.triggerEvent ?? current.triggerEvent) !== 'on_update') throw new InvalidTriggerConditionError('La condición «cambió» requiere el evento Al actualizar.')
      const parsedDecision = decisionCondition !== undefined ? conditionNodeSchema.safeParse(decisionCondition) : conditionNodeSchema.safeParse(current.decisionCondition)
      if (!parsedDecision.success && current.actions.some(action => ['yes', 'no'].includes(String((action.config as Record<string, unknown>).branch)))) throw new InvalidTriggerConditionError('Configura una decisión para las acciones de las ramas.')
      if (parsedDecision.success) {
        if (hasChanged(parsedDecision.data) && (input.triggerEvent ?? current.triggerEvent) !== 'on_update') throw new InvalidTriggerConditionError('La decisión «cambió» requiere el evento Al actualizar.')
        const missingDecisionField = collectConditionFields(parsedDecision.data).find(field => !names.has(field))
        if (missingDecisionField) throw new InvalidTriggerConditionError('La decisión hace referencia a un campo que ya no existe.')
      }
      if (!current.actions.length) throw new InvalidTriggerConditionError('Agrega al menos una acción antes de activar.')
      for (const action of current.actions) {
        validateActionConfig(action.actionType, action.config)
        if (action.actionType === 'update_field' && !names.has((action.config as { field: string }).field)) throw new InvalidTriggerConditionError('Una acción hace referencia a un campo que ya no existe.')
      }
    }
    if (input.name !== undefined) patch.name = input.name
    if (input.triggerEvent !== undefined) patch.triggerEvent = input.triggerEvent
    if (condition !== undefined) patch.condition = condition
    if (decisionCondition !== undefined) patch.decisionCondition = decisionCondition
    if (input.isActive !== undefined) patch.isActive = input.isActive

    const [updated] = await tx
      .update(triggers)
      .set(patch)
      .where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId)))
      .returning({ id: triggers.id })
    if (!updated) return null

    return getTriggerWithTx(tx, tenantId, updated.id)
  })
}

/**
 * Elimina un trigger. A diferencia de relation_definitions (que bloquea el
 * borrado si ya tiene vinculos, porque esos vinculos son datos del usuario),
 * ambas tablas hijas (trigger_actions, trigger_logs) tienen ON DELETE CASCADE
 * reales en el esquema (ERD-47) - trigger_logs es solo historial de
 * ejecucion, no datos de negocio que proteger, asi que el borrado en cascada
 * es seguro y no necesita confirmacion adicional del usuario mas alla del
 * propio boton de borrar.
 */
export async function deleteTrigger(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.delete(triggers).where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId))).returning({ id: triggers.id })
    return result.length > 0
  })
}

async function assertTriggerInTenant(tx: Tx, tenantId: string, triggerId: string): Promise<void> {
  const [row] = await tx.select({ id: triggers.id }).from(triggers).where(and(eq(triggers.id, triggerId), eq(triggers.tenantId, tenantId))).limit(1)
  if (!row) throw new TriggerNotFoundError(`El trigger ${triggerId} no existe en este tenant`)
}

export interface CreateTriggerActionInput {
  actionType: TriggerActionType
  config: unknown
  executionOrder?: number
}

/**
 * Agrega una accion a un trigger existente. La config se valida de entrada
 * contra el schema real de ejecucion (webhook/email/update_field, reusados
 * de triggerActions.ts - NUNCA una copia paralela que pueda desalinearse) -
 * una config invalida se rechaza aca, en vez de recien descubrirse en el
 * primer disparo real (criterio de aceptacion implicito: el editor de
 * acciones no deja guardar algo que va a fallar siempre). Sin
 * `executionOrder` explicito, se agrega al final (max existente + 1).
 */
export async function createTriggerAction(tenantId: string, triggerId: string, input: CreateTriggerActionInput): Promise<TriggerActionItem> {
  validateActionConfig(input.actionType, input.config)

  return withTenant(tenantId, async (tx) => {
    await assertTriggerInTenant(tx, tenantId, triggerId)

    let executionOrder = input.executionOrder
    if (executionOrder === undefined) {
      const existing = await tx.select({ executionOrder: triggerActions.executionOrder }).from(triggerActions).where(eq(triggerActions.triggerId, triggerId))
      executionOrder = existing.length === 0 ? 0 : Math.max(...existing.map((r) => r.executionOrder)) + 1
    }

    const [created] = await tx
      .insert(triggerActions)
      .values({ tenantId, triggerId, actionType: input.actionType, config: input.config, executionOrder })
      .returning({ id: triggerActions.id, actionType: triggerActions.actionType, config: triggerActions.config, executionOrder: triggerActions.executionOrder })

    return created
  })
}

export interface UpdateTriggerActionInput {
  actionType?: TriggerActionType
  config?: unknown
  executionOrder?: number
}

/**
 * Actualiza una accion existente. Si se cambia actionType o config, SIEMPRE
 * se revalida el par (actionType, config) resultante completo contra el
 * schema correspondiente - nunca solo el campo que vino en el body, para no
 * dejar guardada una combinacion invalida (ej. cambiar actionType a "email"
 * sin actualizar tambien la config que traia campos de "webhook").
 */
export async function updateTriggerAction(tenantId: string, id: string, input: UpdateTriggerActionInput): Promise<TriggerActionItem | null> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select().from(triggerActions).where(and(eq(triggerActions.id, id), eq(triggerActions.tenantId, tenantId))).limit(1)
    if (!existing) return null

    const nextActionType = input.actionType ?? (existing.actionType as TriggerActionType)
    const nextConfig = input.config !== undefined ? input.config : existing.config
    if (input.actionType !== undefined || input.config !== undefined) {
      validateActionConfig(nextActionType, nextConfig)
    }

    const patch: Partial<typeof triggerActions.$inferInsert> = { updatedAt: new Date() }
    if (input.actionType !== undefined) patch.actionType = input.actionType
    if (input.config !== undefined) patch.config = input.config
    if (input.executionOrder !== undefined) patch.executionOrder = input.executionOrder

    const [updated] = await tx
      .update(triggerActions)
      .set(patch)
      .where(and(eq(triggerActions.id, id), eq(triggerActions.tenantId, tenantId)))
      .returning({ id: triggerActions.id, actionType: triggerActions.actionType, config: triggerActions.config, executionOrder: triggerActions.executionOrder })
    return updated ?? null
  })
}

export async function deleteTriggerAction(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.delete(triggerActions).where(and(eq(triggerActions.id, id), eq(triggerActions.tenantId, tenantId))).returning({ id: triggerActions.id })
    return result.length > 0
  })
}

/**
 * Reordena TODAS las acciones de un trigger de una vez (mismo patron que
 * reorderEntityFields(), HU-ERD-76 "el organizador") - el body es la lista
 * COMPLETA de action ids en el orden deseado; la posicion en el array pasa a
 * ser el nuevo execution_order. Se valida que sea EXACTAMENTE el conjunto de
 * acciones actual del trigger (ni de mas ni de menos) antes de escribir nada,
 * para no dejar el orden a medio mover si el body viene incompleto o con un
 * id de otro trigger colado.
 */
export async function reorderTriggerActions(tenantId: string, triggerId: string, order: string[]): Promise<TriggerActionItem[]> {
  return withTenant(tenantId, async (tx) => {
    await assertTriggerInTenant(tx, tenantId, triggerId)

    const current = await tx.select({ id: triggerActions.id }).from(triggerActions).where(eq(triggerActions.triggerId, triggerId))
    const currentIds = new Set(current.map((r) => r.id))
    const orderIds = new Set(order)
    if (currentIds.size !== orderIds.size || [...currentIds].some((id) => !orderIds.has(id))) {
      throw new InvalidTriggerActionOrderError('El orden debe incluir exactamente las acciones actuales de este trigger, sin repetir ni omitir ninguna')
    }

    for (let i = 0; i < order.length; i++) {
      await tx.update(triggerActions).set({ executionOrder: i, updatedAt: new Date() }).where(eq(triggerActions.id, order[i]))
    }

    return tx
      .select({ id: triggerActions.id, actionType: triggerActions.actionType, config: triggerActions.config, executionOrder: triggerActions.executionOrder })
      .from(triggerActions)
      .where(eq(triggerActions.triggerId, triggerId))
      .orderBy(asc(triggerActions.executionOrder))
  })
}

export interface TriggerLogItem {
  id: string
  recordId: string | null
  status: string
  attemptCount: number
  lastError: string | null
  responseStatus: number | null
  createdAt: Date
  updatedAt: Date
}

/** Ultimas ejecuciones de un trigger, mas recientes primero - para la vista de auditoria de ERD-51. */
export async function listTriggerLogs(tenantId: string, triggerId: string, limit = 50): Promise<TriggerLogItem[]> {
  return withTenant(tenantId, async (tx) => {
    await assertTriggerInTenant(tx, tenantId, triggerId)

    return tx
      .select({
        id: triggerLogs.id,
        recordId: triggerLogs.recordId,
        status: triggerLogs.status,
        attemptCount: triggerLogs.attemptCount,
        lastError: triggerLogs.lastError,
        responseStatus: triggerLogs.responseStatus,
        createdAt: triggerLogs.createdAt,
        updatedAt: triggerLogs.updatedAt
      })
      .from(triggerLogs)
      .where(eq(triggerLogs.triggerId, triggerId))
      .orderBy(desc(triggerLogs.createdAt))
      .limit(limit)
  })
}

/**
 * Boton "reintentar" manual de la vista de trigger_logs (ERD-51). A
 * diferencia del job automatico (que solo toca 'retrying', respetando el
 * backoff), esto fuerza el reintento aunque el log este en 'failed' o
 * 'dead_letter' - un administrador que ya corrigio la causa raiz (URL de
 * webhook, SMTP, campo de update_field) no deberia tener que esperar a que el
 * job lo levante solo, y 'failed'/'dead_letter' nunca lo hacen solos.
 */
export async function retryTriggerLogManually(tenantId: string, logId: string): Promise<TriggerLogItem | null> {
  const [before] = await withTenant(tenantId, (tx) =>
    tx.select({ id: triggerLogs.id, status: triggerLogs.status }).from(triggerLogs).where(and(eq(triggerLogs.id, logId), eq(triggerLogs.tenantId, tenantId))).limit(1)
  )
  if (!before) throw new TriggerLogNotFoundError(`El log ${logId} no existe en este tenant`)
  if (before.status === 'success') return getTriggerLog(tenantId, logId)

  await retryTriggerLog(tenantId, logId, { force: true })
  return getTriggerLog(tenantId, logId)
}

async function getTriggerLog(tenantId: string, logId: string): Promise<TriggerLogItem | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: triggerLogs.id,
        recordId: triggerLogs.recordId,
        status: triggerLogs.status,
        attemptCount: triggerLogs.attemptCount,
        lastError: triggerLogs.lastError,
        responseStatus: triggerLogs.responseStatus,
        createdAt: triggerLogs.createdAt,
        updatedAt: triggerLogs.updatedAt
      })
      .from(triggerLogs)
      .where(and(eq(triggerLogs.id, logId), eq(triggerLogs.tenantId, tenantId)))
      .limit(1)
  )
  return row ?? null
}
