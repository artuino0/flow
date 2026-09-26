import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import type { db } from '~/server/db'
import { entities, entityFields, records, recordActivities, roles } from '~/server/db/schema'

export const stateWorkflowSchema = z.object({
  enabled: z.boolean(),
  field: z.string().min(1),
  initial: z.string().min(1),
  states: z.record(z.object({ locked: z.boolean(), editableFields: z.array(z.string()).default([]) }).strict()),
  transitions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), roles: z.union([z.array(z.string()), z.literal('all')]), label: z.string().trim().min(1).optional() }).strict()),
  rules: z.array(z.unknown()).optional()
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
  return config
}

export async function enforceWorkflowChange(tx: typeof db, args: { tenantId: string; entityId: string; roleId: string; userId: string | null; recordId: string; current: Record<string, unknown>; next: Record<string, unknown>; changedFields: string[] }) {
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
  await tx.insert(recordActivities).values({ tenantId: args.tenantId, recordId: args.recordId, userId: args.userId, actionType: 'STATUS_CHANGED', details: { field: config.field, from, to } })
  return transition
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
