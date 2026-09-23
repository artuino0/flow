import { and, eq, isNull, sql as dsql } from 'drizzle-orm'
import { entities, entityFields, records } from '~/server/db/schema'

type Tx = any

export type FormulaCalculation = {
  kind: 'formula'
  operator: 'add' | 'subtract' | 'multiply' | 'divide'
  leftField: string
  rightField: string
}

export type RollupCalculation = {
  kind: 'rollup'
  aggregate: 'sum' | 'count'
  sourceEntity: string
  relationField: string
  valueField?: string
}

export type CalculationConfig = FormulaCalculation | RollupCalculation

export interface CalculatedFieldRow {
  name: string
  dataType: string
  validationRules: unknown
}

function asRules(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function getCalculation(field: CalculatedFieldRow): CalculationConfig | null {
  if (field.dataType !== 'number' && field.dataType !== 'currency') return null
  const candidate = asRules(field.validationRules).calculation
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const calculation = candidate as Record<string, unknown>
  if (calculation.kind === 'formula' && ['add', 'subtract', 'multiply', 'divide'].includes(String(calculation.operator)) && typeof calculation.leftField === 'string' && typeof calculation.rightField === 'string') {
    return calculation as FormulaCalculation
  }
  if (calculation.kind === 'rollup' && ['sum', 'count'].includes(String(calculation.aggregate)) && typeof calculation.sourceEntity === 'string' && typeof calculation.relationField === 'string') {
    return calculation as RollupCalculation
  }
  return null
}

export function isCalculatedField(field: CalculatedFieldRow): boolean {
  return getCalculation(field) !== null
}

export function stripCalculatedValues(fields: CalculatedFieldRow[], value: Record<string, unknown>): Record<string, unknown> {
  const calculated = new Set(fields.filter(isCalculatedField).map(field => field.name))
  return Object.fromEntries(Object.entries(value).filter(([name]) => !calculated.has(name)))
}

function numeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function serialize(field: CalculatedFieldRow, value: number): number | string {
  const rules = asRules(field.validationRules)
  if (field.dataType === 'currency') {
    const decimals = typeof rules.decimals === 'number' ? Math.max(0, Math.min(4, rules.decimals)) : 2
    return round(value, decimals).toFixed(decimals)
  }
  if (rules.integer === true) return Math.round(value)
  return round(value, 10)
}

function sameData(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function applyCalculatedFields(
  tx: Tx,
  tenantId: string,
  entityId: string,
  input: Record<string, unknown>,
  recordId?: string,
  suppliedFields?: CalculatedFieldRow[]
): Promise<Record<string, unknown>> {
  const fields: CalculatedFieldRow[] = suppliedFields ?? await tx
    .select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
    .from(entityFields)
    .where(eq(entityFields.entityId, entityId))

  const result = { ...input }
  const calculated = new Map(fields.map(field => [field.name, { field, calculation: getCalculation(field) }]).filter((entry) => entry[1].calculation))
  const visiting = new Set<string>()
  const completed = new Set<string>()

  const evaluate = async (name: string): Promise<void> => {
    if (completed.has(name)) return
    if (visiting.has(name)) throw new Error(`La fórmula del campo "${name}" contiene una dependencia circular`)
    const definition = calculated.get(name)
    if (!definition?.calculation) return
    visiting.add(name)

    let value = 0
    const calculation = definition.calculation
    if (calculation.kind === 'formula') {
      if (calculated.has(calculation.leftField)) await evaluate(calculation.leftField)
      if (calculated.has(calculation.rightField)) await evaluate(calculation.rightField)
      const left = numeric(result[calculation.leftField])
      const right = numeric(result[calculation.rightField])
      if (calculation.operator === 'add') value = left + right
      else if (calculation.operator === 'subtract') value = left - right
      else if (calculation.operator === 'multiply') value = left * right
      else value = right === 0 ? 0 : left / right
    } else if (recordId) {
      const [sourceEntity] = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.tenantId, tenantId), eq(entities.slug, calculation.sourceEntity)))
        .limit(1)
      if (sourceEntity) {
        const sourceRows = await tx
          .select({ customData: records.customData })
          .from(records)
          .where(and(
            eq(records.tenantId, tenantId),
            eq(records.entityId, sourceEntity.id),
            isNull(records.deletedAt),
            dsql`${records.customData}->>${calculation.relationField} = ${recordId}`
          ))
        value = calculation.aggregate === 'count'
          ? sourceRows.length
          : sourceRows.reduce((sum: number, row: { customData: unknown }) => sum + numeric(asRules(row.customData)[calculation.valueField ?? '']), 0)
      }
    }

    result[name] = serialize(definition.field, value)
    visiting.delete(name)
    completed.add(name)
  }

  for (const name of calculated.keys()) await evaluate(name)
  return result
}

/**
 * Recalcula los registros destino que dependen de un registro fuente. Por
 * ejemplo, al guardar/eliminar un pago vuelve a sumar el total pagado de su
 * cuenta por cobrar y después recalcula el saldo.
 */
export async function recalculateCalculatedDependents(
  tx: Tx,
  tenantId: string,
  sourceEntityId: string,
  previousData?: Record<string, unknown> | null,
  currentData?: Record<string, unknown> | null
): Promise<void> {
  const [sourceEntity] = await tx
    .select({ slug: entities.slug })
    .from(entities)
    .where(and(eq(entities.id, sourceEntityId), eq(entities.tenantId, tenantId)))
    .limit(1)
  if (!sourceEntity) return

  const candidates = await tx
    .select({
      entityId: entityFields.entityId,
      name: entityFields.name,
      dataType: entityFields.dataType,
      validationRules: entityFields.validationRules
    })
    .from(entityFields)
    .innerJoin(entities, and(eq(entities.id, entityFields.entityId), eq(entities.tenantId, tenantId)))

  const rollups = candidates
    .map(field => ({ field, calculation: getCalculation(field) }))
    .filter((item): item is { field: CalculatedFieldRow & { entityId: string }; calculation: RollupCalculation } => item.calculation?.kind === 'rollup' && item.calculation.sourceEntity === sourceEntity.slug)

  const fieldsByEntity = new Map<string, CalculatedFieldRow[]>()
  for (const candidate of candidates) {
    const list = fieldsByEntity.get(candidate.entityId) ?? []
    list.push(candidate)
    fieldsByEntity.set(candidate.entityId, list)
  }

  const targets = new Map<string, { entityId: string; recordId: string }>()
  for (const rollup of rollups) {
    for (const data of [previousData, currentData]) {
      const recordId = data?.[rollup.calculation.relationField]
      if (typeof recordId === 'string' && recordId) targets.set(`${rollup.field.entityId}:${recordId}`, { entityId: rollup.field.entityId, recordId })
    }
  }

  for (const target of targets.values()) {
    const [record] = await tx
      .select({ customData: records.customData })
      .from(records)
      .where(and(eq(records.id, target.recordId), eq(records.tenantId, tenantId), eq(records.entityId, target.entityId), isNull(records.deletedAt)))
      .limit(1)
    if (!record) continue
    const before = asRules(record.customData)
    const after = await applyCalculatedFields(tx, tenantId, target.entityId, before, target.recordId, fieldsByEntity.get(target.entityId))
    if (sameData(before, after)) continue
    await tx.update(records)
      .set({ customData: after, isDirty: false, updatedAt: new Date() })
      .where(and(eq(records.id, target.recordId), eq(records.tenantId, tenantId)))
  }
}
