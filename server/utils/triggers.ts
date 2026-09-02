import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entityFields, triggerLogs, triggers } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

// HU-ERD-48: motor de evaluacion de condiciones de triggers (ERD-47), sin
// ejecucion de codigo arbitrario. `condition` es un DSL declarativo JSON -
// nunca se llama eval()/new Function()/similares sobre nada que venga de la
// base o del usuario; el "motor" es simplemente recorrer un arbol de objetos
// ya validado con Zod.

export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

export interface ConditionLeaf {
  field: string
  operator: ConditionOperator
  value: unknown
}
export interface ConditionAnd {
  and: ConditionNode[]
}
export interface ConditionOr {
  or: ConditionNode[]
}
export type ConditionNode = ConditionLeaf | ConditionAnd | ConditionOr

// z.any() hace que Zod infiera "value" como opcional (undefined extends any),
// aunque ConditionLeaf.value no lo sea - un leaf sin "value" (o con value:
// undefined) parsea igual, con value undefined, y evaluateLeaf() lo compara
// como cualquier otro (undefined !== 'nuevo', etc.) sin romper. Por eso el
// schema NO se anota con z.ZodType<ConditionLeaf> aca; el cast final ocurre
// una sola vez mas abajo, sobre el union completo.
const conditionLeafSchema = z
  .object({
    field: z.string().min(1),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.any()
  })
  .strict()

// z.lazy() porque el arbol es recursivo (and/or contienen mas ConditionNode) -
// mismo patron que cualquier schema Zod recursivo, sin nada especifico de
// este proyecto. El cast a ZodType<ConditionNode> es deliberado (ver
// comentario arriba de conditionLeafSchema) - solo ajusta como TS infiere el
// tipo, la forma que valida en runtime no cambia.
export const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    conditionLeafSchema,
    z.object({ and: z.array(conditionNodeSchema).min(1) }).strict(),
    z.object({ or: z.array(conditionNodeSchema).min(1) }).strict()
  ])
) as z.ZodType<ConditionNode>

function isLeaf(node: ConditionNode): node is ConditionLeaf {
  return 'field' in node
}

/** Nombres de campo referenciados en TODO el arbol (recursivo), para validarlos contra entity_fields. */
export function collectConditionFields(node: ConditionNode): string[] {
  if (isLeaf(node)) return [node.field]
  if ('and' in node) return node.and.flatMap(collectConditionFields)
  return node.or.flatMap(collectConditionFields)
}

function evaluateLeaf(leaf: ConditionLeaf, data: Record<string, unknown>): boolean {
  const actual = data[leaf.field]
  const expected = leaf.value
  switch (leaf.operator) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected)
      if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected)
      return false
    default:
      return false
  }
}

function evaluateNode(node: ConditionNode, data: Record<string, unknown>): boolean {
  if (isLeaf(node)) return evaluateLeaf(node, data)
  if ('and' in node) return node.and.every((n) => evaluateNode(n, data))
  return node.or.some((n) => evaluateNode(n, data))
}

/**
 * Evalua un `condition` (JSONB de triggers.condition) contra el customData
 * de un record. Exportada sin acceso a base de datos (mismo criterio que
 * buildFieldType() en dynamicSchema.ts, HU-ERD-17/29) para poder testearla
 * unitariamente sin Postgres.
 *
 * Un condition vacio/sin forma valida (`{}`, el default de una fila recien
 * creada y aun sin configurar) NO se trata como "siempre dispara" - se
 * considera invalido (ver evaluateTriggersForRecord() mas abajo, que es
 * quien realmente decide "invalido" vs "false"). Esta funcion sola, sobre
 * algo que no matchea el schema, tira - el caller decide que hacer con eso.
 */
export function evaluateCondition(condition: unknown, data: Record<string, unknown>): boolean {
  const node = conditionNodeSchema.parse(condition)
  return evaluateNode(node, data)
}

export type TriggerEventName = 'on_create' | 'on_update' | 'on_delete' | 'on_transition'

export interface MatchedTrigger {
  id: string
  name: string
}

export interface InvalidTrigger {
  id: string
  name: string
  reason: string
}

export interface TriggerEvaluationResult {
  matched: MatchedTrigger[]
  invalid: InvalidTrigger[]
}

/**
 * Resuelve, para una entidad+evento+customData dados, que triggers activos
 * disparan. Se llama DESPUES de que el insert/update/delete de records
 * (ERD-16) ya se confirmo en la base - los endpoints la invocan sin `await`
 * (fire-and-forget, ver server/api/records/[entity]/*.ts) para que nunca
 * agregue latencia ni pueda fallar la respuesta HTTP al cliente.
 *
 * Cada campo referenciado en la condicion de un trigger debe existir en
 * entity_fields de esa entidad (mismo diccionario dinamico que ERD-17
 * usa para armar el schema Zod) - si no existe, o si el condition no tiene
 * una forma valida (ej. `{}` default, sin configurar todavia), el trigger se
 * marca invalido: NO se evalua como true/false, se registra una fila en
 * trigger_logs (status 'failed', con el motivo en last_error) para que el
 * problema sea visible en la UI de triggers (ERD-51) en vez de fallar en
 * silencio. Todavia no ejecuta ninguna accion (ERD-49) - esta HU solo
 * resuelve QUE triggers matchean.
 */
export async function evaluateTriggersForRecord(
  tenantId: string,
  entityId: string,
  event: TriggerEventName,
  customData: Record<string, unknown>
): Promise<TriggerEvaluationResult> {
  return withTenant(tenantId, async (tx) => {
    const activeTriggers = await tx
      .select({ id: triggers.id, name: triggers.name, condition: triggers.condition })
      .from(triggers)
      .where(and(eq(triggers.tenantId, tenantId), eq(triggers.entityId, entityId), eq(triggers.triggerEvent, event), eq(triggers.isActive, true)))

    if (activeTriggers.length === 0) {
      return { matched: [], invalid: [] }
    }

    const fieldRows = await tx.select({ name: entityFields.name }).from(entityFields).where(eq(entityFields.entityId, entityId))
    const validFieldNames = new Set(fieldRows.map((r) => r.name))

    const matched: MatchedTrigger[] = []
    const invalid: InvalidTrigger[] = []

    for (const trigger of activeTriggers) {
      const parsedCondition = conditionNodeSchema.safeParse(trigger.condition)
      if (!parsedCondition.success) {
        invalid.push({ id: trigger.id, name: trigger.name, reason: 'La condición no tiene una forma válida (¿trigger sin configurar todavía?)' })
        continue
      }

      const referencedFields = collectConditionFields(parsedCondition.data)
      const missingField = referencedFields.find((f) => !validFieldNames.has(f))
      if (missingField) {
        invalid.push({ id: trigger.id, name: trigger.name, reason: `El campo "${missingField}" no existe en esta entidad` })
        continue
      }

      if (evaluateNode(parsedCondition.data, customData)) {
        matched.push({ id: trigger.id, name: trigger.name })
      }
    }

    if (invalid.length > 0) {
      await tx.insert(triggerLogs).values(
        invalid.map((inv) => ({
          tenantId,
          triggerId: inv.id,
          status: 'failed',
          lastError: inv.reason
        }))
      )
    }

    return { matched, invalid }
  })
}

/**
 * Punto de enganche desde los endpoints de records (ERD-16): llama a
 * evaluateTriggersForRecord() SIN esperar su resultado (fire-and-forget) y
 * nunca deja que un error se escape - un fallo aca jamas debe convertirse en
 * un 500 para el cliente que solo estaba creando/editando/borrando un
 * record. Los matches todavia no HACEN nada (ERD-49 construye la ejecucion
 * real de trigger_actions) - por ahora solo quedan logueados via logger.info
 * para poder confirmar en desarrollo que el motor los esta detectando.
 */
export function fireTriggersForRecord(tenantId: string, entityId: string, event: TriggerEventName, customData: Record<string, unknown>): void {
  evaluateTriggersForRecord(tenantId, entityId, event, customData)
    .then((result) => {
      if (result.matched.length > 0) {
        logger.info('triggers matched (ejecución pendiente de ERD-49)', {
          tenantId,
          entityId,
          event,
          matched: result.matched.map((m) => m.id)
        })
      }
    })
    .catch((err) => {
      logger.error('fallo evaluando triggers', { tenantId, entityId, event, error: err instanceof Error ? err.message : String(err) })
    })
}
