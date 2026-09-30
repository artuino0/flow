import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import type { db } from '~/server/db'
import { entities, entityFields, records, recordActivities, roles } from '~/server/db/schema'
import { recordNotDeleted } from '~/server/utils/records'

export const stateWorkflowSchema = z.object({
  enabled: z.boolean(),
  field: z.string().min(1),
  initial: z.string().min(1),
  states: z.record(z.object({ locked: z.boolean(), editableFields: z.array(z.string()).default([]) }).strict()),
  transitions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), roles: z.union([z.array(z.string()), z.literal('all')]), label: z.string().trim().min(1).optional() }).strict()),
  layout: z.record(z.object({ x: z.number().finite(), y: z.number().finite() }).strict()).optional(),
  rules: z.array(z.discriminatedUnion('type', [
    z.object({ id: z.string().optional(), type: z.literal('required'), mode: z.enum(['block', 'warn']), when: z.object({ to: z.string().min(1), from: z.string().min(1).optional() }).strict(), fields: z.array(z.string().min(1)).min(1), message: z.string().trim().min(1) }).strict(),
    z.object({ id: z.string().optional(), type: z.literal('lineCompare'), mode: z.enum(['block', 'warn']), when: z.object({ to: z.string().min(1), from: z.string().min(1).optional() }).strict(), lineEntity: z.string().min(1), relationField: z.string().min(1), valueField: z.string().min(1), relatedField: z.string().min(1), compareField: z.string().min(1), operator: z.enum(['<=', '<', '>=', '>', '=']), message: z.string().trim().min(1) }).strict(),
    z.object({ id: z.string().optional(), type: z.literal('aggregate'), mode: z.enum(['block', 'warn']), when: z.object({ to: z.string().min(1), from: z.string().min(1).optional() }).strict(), lineEntity: z.string().min(1), relationField: z.string().min(1), aggregate: z.enum(['sum', 'count']), field: z.string().optional(), operator: z.enum(['<=', '<', '>=', '>', '=']), value: z.number(), message: z.string().trim().min(1) }).strict()
  ])).optional()
}).strict().superRefine((config, ctx) => {
  if (!config.enabled) return
  if (!config.states[config.initial]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initial'], message: 'El estado inicial debe existir' })
  const pairs = new Set<string>()
  for (const [value, state] of Object.entries(config.states)) {
    if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['states'], message: 'Los valores de estado no pueden estar vacíos' })
    if (!state.locked && state.editableFields.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['states', value, 'editableFields'], message: 'Los campos exceptuados solo aplican a estados bloqueantes' })
  }
  for (const transition of config.transitions) {
    if (!config.states[transition.from] || !config.states[transition.to]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions'], message: 'Cada transición debe conectar estados configurados' })
    const pair = `${transition.from}\u0000${transition.to}`
    if (pairs.has(pair)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions'], message: 'No se permiten transiciones duplicadas' })
    pairs.add(pair)
  }
  for (const rule of config.rules ?? []) if (!config.states[rule.when.to] || (rule.when.from && !config.states[rule.when.from])) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rules'], message: 'Cada regla debe usar estados configurados' })
})

export type StateWorkflow = z.infer<typeof stateWorkflowSchema>
export class StateWorkflowError extends Error {
  constructor(message: string, readonly statusCode: number = 422) { super(message) }
}

export async function validateWorkflowConfig(tx: typeof db, tenantId: string, entityId: string, value: unknown): Promise<StateWorkflow | null> {
  if (value === null) return null
  const parsed = stateWorkflowSchema.safeParse(value)
  if (!parsed.success) throw new StateWorkflowError(`Configuración de flujo inválida: ${parsed.error.issues[0]?.message ?? 'revisa los datos'}`)
  const config = parsed.data
  const [parentEntity] = await tx.select({ slug: entities.slug, detailLayout: entities.detailLayout }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
  const inverseRelations = (parentEntity?.detailLayout as { relations?: Array<{ entitySlug?: string; fieldName?: string }> } | null)?.relations ?? []
  if (!config.enabled) return config
  const [field] = await tx.select({ dataType: entityFields.dataType, validationRules: entityFields.validationRules }).from(entityFields)
    .where(and(eq(entityFields.entityId, entityId), eq(entityFields.name, config.field))).limit(1)
  if (!field || field.dataType !== 'select') throw new StateWorkflowError('El flujo debe usar un campo Select existente')
  const options = (field.validationRules as { options?: Array<{ value?: unknown }> } | null)?.options
  const values = new Set(Array.isArray(options) ? options.map(option => String(option.value)) : [])
  if (!values.size || [...Object.keys(config.states), config.initial, ...config.transitions.flatMap(item => [item.from, item.to])].some(state => !values.has(state))) {
    throw new StateWorkflowError('Los estados del flujo deben coincidir con las opciones actuales del campo Select')
  }
  const roleIds = [...new Set(config.transitions.flatMap(item => item.roles === 'all' ? [] : item.roles))]
  if (roleIds.length) {
    const existing = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId)))
    const known = new Set(existing.map((role: { id: string }) => role.id))
    if (roleIds.some(id => !known.has(id))) throw new StateWorkflowError('Una transición referencia un rol inexistente')
  }
  const fieldNames = new Set((await tx.select({ name: entityFields.name }).from(entityFields).where(eq(entityFields.entityId, entityId))).map((item: { name: string }) => item.name))
  if (Object.values(config.states).some(state => state.editableFields.some(name => !fieldNames.has(name)))) throw new StateWorkflowError('Un campo exceptuado no existe en el módulo')
  for (const rule of config.rules ?? []) {
    if (rule.type === 'required' && rule.fields.some(name => !fieldNames.has(name))) throw new StateWorkflowError('Una regla required referencia un campo inexistente')
    if (rule.type !== 'required') {
      const inverse = inverseRelations.some(item => item.entitySlug === rule.lineEntity && item.fieldName === rule.relationField)
      if (!inverse) throw new StateWorkflowError('La regla debe usar una relación inversa configurada en el detalle')
      const [lineEntity] = await tx.select({ id: entities.id, slug: entities.slug }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, rule.lineEntity))).limit(1)
      if (!lineEntity) throw new StateWorkflowError('La relación inversa de la regla no existe')
      const lineFields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules }).from(entityFields).where(eq(entityFields.entityId, lineEntity.id))
      const lineByName = new Map(lineFields.map(field => [field.name, field]))
      const parentSlug = parentEntity?.slug
      const linkField = lineByName.get(rule.relationField)
      if (linkField?.dataType !== 'relation' || (linkField.validationRules as { relationEntity?: string } | null)?.relationEntity !== parentSlug) throw new StateWorkflowError('La regla debe enlazar cada partida con este módulo')
      if (rule.type === 'lineCompare' && (lineByName.get(rule.valueField)?.dataType !== 'number' || lineByName.get(rule.relatedField)?.dataType !== 'relation')) throw new StateWorkflowError('lineCompare requiere una cantidad numérica y una relación de partida')
      if (rule.type === 'lineCompare') {
        const relatedSlug = (lineByName.get(rule.relatedField)?.validationRules as { relationEntity?: string } | null)?.relationEntity
        const [relatedEntity] = relatedSlug ? await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, relatedSlug))).limit(1) : []
        const [compareField] = relatedEntity ? await tx.select({ dataType: entityFields.dataType }).from(entityFields).where(and(eq(entityFields.entityId, relatedEntity.id), eq(entityFields.name, rule.compareField))).limit(1) : []
        if (compareField?.dataType !== 'number') throw new StateWorkflowError('lineCompare requiere un campo numérico en la entidad relacionada')
      }
      if (rule.type === 'aggregate' && rule.aggregate === 'sum' && (!rule.field || lineByName.get(rule.field)?.dataType !== 'number')) throw new StateWorkflowError('aggregate sum requiere un campo numérico de partida')
    }
  }
  return config
}

export async function enforceWorkflowChange(tx: typeof db, args: { tenantId: string; entityId: string; roleId: string; userId: string | null; recordId: string; current: Record<string, unknown>; next: Record<string, unknown>; changedFields: string[]; acknowledgeWarnings?: boolean }) {
  const [entity] = await tx.select({ workflowConfig: entities.workflowConfig }).from(entities).where(and(eq(entities.id, args.entityId), eq(entities.tenantId, args.tenantId))).limit(1)
  const parsed = stateWorkflowSchema.safeParse(entity?.workflowConfig)
  if (!parsed.success || !parsed.data.enabled) return null
  const config = parsed.data
  const from = args.current[config.field] == null ? '' : String(args.current[config.field])
  const to = args.next[config.field] == null ? '' : String(args.next[config.field])
  if (!config.states[from]) return null
  const transition = from !== to ? config.transitions.find(item => item.from === from && item.to === to) : undefined
  if (from !== to && (!transition || (transition.roles !== 'all' && !transition.roles.includes(args.roleId)))) throw new StateWorkflowError(`No tienes autorización para cambiar el estado de "${from || 'vacío'}" a "${to || 'vacío'}"`, 403)
  const state = config.states[from]
  if (state?.locked) {
    const denied = args.changedFields.filter(name => name !== config.field && !state.editableFields.includes(name))
    if (denied.length) throw new StateWorkflowError(`El registro está bloqueado en este estado. No se pueden editar: ${denied.join(', ')}`, 409)
  }
  if (!transition) return null
  const failures: Array<{ mode: 'block' | 'warn'; message: string }> = []
  const matchingRules = (config.rules ?? []).filter(rule => rule.when.to === to && (!rule.when.from || rule.when.from === from))
  for (const rule of matchingRules) {
    if (rule.type === 'required') {
      const missing = rule.fields.filter(name => args.next[name] === null || args.next[name] === undefined || args.next[name] === '')
      if (missing.length) failures.push({ mode: rule.mode, message: `${rule.message}: ${missing.join(', ')}` })
    } else {
      const childEntity = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, args.tenantId), eq(entities.slug, rule.lineEntity))).limit(1)
      const childRows = childEntity[0] ? await tx.select({ customData: records.customData }).from(records).where(and(eq(records.tenantId, args.tenantId), eq(records.entityId, childEntity[0].id), recordNotDeleted)) : []
      const lines = childRows.map(row => row.customData as Record<string, unknown>).filter(data => String(data[rule.relationField] ?? '') === args.recordId)
      if (rule.type === 'aggregate') {
        const actual = rule.aggregate === 'count' ? lines.length : lines.reduce((sum, line) => sum + (Number(line[rule.field!]) || 0), 0)
        if (!compare(actual, rule.operator, rule.value)) failures.push({ mode: rule.mode, message: `${rule.message} (resultado: ${actual})` })
      } else {
        const relName = (await tx.select({ validationRules: entityFields.validationRules }).from(entityFields).where(and(eq(entityFields.entityId, childEntity[0]?.id ?? ''), eq(entityFields.name, rule.relatedField))).limit(1))[0]
        const relatedSlug = (relName?.validationRules as { relationEntity?: string } | null)?.relationEntity
        const relatedEntity = relatedSlug ? await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, args.tenantId), eq(entities.slug, relatedSlug))).limit(1) : []
        const relatedRows = relatedEntity[0] ? await tx.select({ id: records.id, customData: records.customData }).from(records).where(and(eq(records.tenantId, args.tenantId), eq(records.entityId, relatedEntity[0].id), recordNotDeleted)) : []
        const byId = new Map(relatedRows.map(row => [row.id, row.customData as Record<string, unknown>]))
        for (const line of lines) {
          const product = byId.get(String(line[rule.relatedField] ?? ''))
          const actual = Number(line[rule.valueField]); const expected = Number(product?.[rule.compareField])
          if (!Number.isFinite(actual) || !Number.isFinite(expected) || !compare(actual, rule.operator, expected)) {
            const shortage = rule.operator === '<=' || rule.operator === '<' ? Math.max(0, actual - expected) : Math.max(0, expected - actual)
            failures.push({ mode: rule.mode, message: `${rule.message}: ${String(product?.nombre ?? product?.name ?? line[rule.relatedField] ?? 'Partida')} (${actual} vs ${expected}; faltante ${shortage})` })
          }
        }
      }
    }
  }
  const blocked = failures.filter(item => item.mode === 'block')
  const warnings = failures.filter(item => item.mode === 'warn')
  if (blocked.length) throw new StateWorkflowError(blocked.map(item => item.message).join('\n'), 422)
  if (warnings.length && !args.acknowledgeWarnings) throw new StateWorkflowError(`WARNINGS:${JSON.stringify(warnings.map(item => item.message))}`, 422)
  await tx.insert(recordActivities).values({ tenantId: args.tenantId, recordId: args.recordId, userId: args.userId, actionType: 'STATUS_CHANGED', details: { field: config.field, from, to, ...(warnings.length ? { acceptedWarnings: warnings.map(item => item.message) } : {}) } })
  return { ...transition, acceptedWarnings: warnings.map(item => item.message) }
}

function compare(left: number, operator: '<=' | '<' | '>=' | '>' | '=', right: number): boolean {
  if (operator === '<=') return left <= right
  if (operator === '<') return left < right
  if (operator === '>=') return left >= right
  if (operator === '>') return left > right
  return left === right
}

export async function assertWorkflowNotLocked(tx: typeof db, tenantId: string, entityId: string, data: Record<string, unknown>) {
  const [entity] = await tx.select({ workflowConfig: entities.workflowConfig }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
  const parsed = stateWorkflowSchema.safeParse(entity?.workflowConfig)
  if (parsed.success && parsed.data.enabled && parsed.data.states[String(data[parsed.data.field] ?? '')]?.locked) {
    throw new StateWorkflowError('No se puede eliminar un registro bloqueado por su estado', 409)
  }
}

export async function assertEditableLineParents(tx: typeof db, tenantId: string, childEntityId: string, fields: Array<{ name: string; dataType: string; validationRules: unknown }>, data: Record<string, unknown>) {
  const [childEntity] = await tx.select({ slug: entities.slug }).from(entities).where(and(eq(entities.id, childEntityId), eq(entities.tenantId, tenantId))).limit(1)
  if (!childEntity) return
  for (const field of fields) {
    if (field.dataType !== 'relation') continue
    const relationEntity = (field.validationRules as { relationEntity?: unknown } | null)?.relationEntity
    const parentId = data[field.name]
    if (typeof relationEntity !== 'string' || typeof parentId !== 'string' || !parentId) continue
    const [parentEntity] = await tx.select({ id: entities.id, slug: entities.slug, workflowConfig: entities.workflowConfig, detailLayout: entities.detailLayout })
      .from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, relationEntity))).limit(1)
    if (!parentEntity) continue
    const layout = parentEntity.detailLayout as { relations?: Array<{ entitySlug?: string; fieldName?: string; editable?: boolean }> } | null
    if (!layout?.relations?.some(item => item.entitySlug === childEntity.slug && item.fieldName === field.name && item.editable)) continue
    const [parent] = await tx.select({ customData: records.customData }).from(records).where(and(eq(records.id, parentId), eq(records.entityId, parentEntity.id), eq(records.tenantId, tenantId))).limit(1)
    if (!parent) continue
    const workflow = stateWorkflowSchema.safeParse(parentEntity.workflowConfig)
    if (workflow.success && workflow.data.enabled && workflow.data.states[String((parent.customData as Record<string, unknown>)[workflow.data.field] ?? '')]?.locked) {
      throw new StateWorkflowError('No se pueden crear o modificar partidas de un registro bloqueado', 409)
    }
  }
}
