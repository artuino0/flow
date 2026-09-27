import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { blueprintApplications, entities, entityFields } from '~/server/db/schema'
import { assertPlanCapacity } from '~/server/utils/billing'
import { createEntityInTx, updateEntityInTx } from '~/server/utils/moduleEntities'
import { createEntityFieldInTx } from '~/server/utils/moduleEntityFields'
import { createRelationDefinitionInTx } from '~/server/utils/relationDefinitions'
import { invalidateTenantAccess } from '~/server/utils/shortCache'
import { invalidateEntitySchemaCache } from '~/server/utils/dynamicSchema'
import { detailLayoutSchema } from '~/server/utils/detailLayout'
import { validateWorkflowConfig } from '~/server/utils/stateWorkflow'
import { collectFieldRefs, parseExpression } from '~/utils/calcExpression'
import type { Blueprint, BlueprintField } from './schema'
import { validateBlueprint } from './validate'
import { blueprintPlanImpact } from './plan'

export interface BlueprintApplyResult { modules: Array<{ id: string; slug: string }>; fields: Array<{ entityId: string; name: string }>; associations: string[]; layouts: string[]; workflows: string[]; merges: Array<{ from: string; to: string; message: string; discardedFields: string[] }> }

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
const hashBlueprint = (blueprint: unknown) => createHash('sha256').update(JSON.stringify(stable(blueprint))).digest('hex')

export async function applyBlueprint(tenantId: string, userId: string | null, input: unknown, idempotencyKey: string): Promise<BlueprintApplyResult> {
  if (!idempotencyKey || idempotencyKey.length > 200) throw createError({ statusCode: 422, statusMessage: 'La clave de idempotencia es obligatoria y debe tener hasta 200 caracteres' })
  const blueprintHash = hashBlueprint(input)
  const previous = await withTenant(tenantId, tx => tx.select().from(blueprintApplications).where(and(eq(blueprintApplications.tenantId, tenantId), eq(blueprintApplications.idempotencyKey, idempotencyKey))).limit(1))
  if (previous[0]) {
    if (previous[0].blueprintHash !== blueprintHash) throw createError({ statusCode: 409, statusMessage: 'Esta clave de idempotencia se usó con otro plano' })
    return previous[0].result as BlueprintApplyResult
  }
  const checked = await validateBlueprint(tenantId, input)
  const normalized = checked.normalized
  if (!normalized) throw createError({ statusCode: 422, statusMessage: 'El plano tiene un formato inválido', data: { errors: checked.errors } })
  if (checked.errors.some(error => error.code !== 'plan_limit')) throw createError({ statusCode: 422, statusMessage: 'El plano contiene errores', data: { errors: checked.errors } })
  const incoming = normalized.modules.filter(module => module.action === 'create' && module.kind === 'hecho').length
  if (checked.errors.some(error => error.code === 'plan_limit')) {
    const plan = await blueprintPlanImpact(tenantId, incoming)
    throw createError({ statusCode: 402, statusMessage: `Se alcanzó el límite de módulos del plan ${plan.name}. Mejora tu plan para continuar.`, data: { code: 'plan_limit', concept: 'modules', used: plan.used, limit: plan.limit, plan: plan.code } })
  }
  if (incoming) await assertPlanCapacity(tenantId, 'modules', incoming)

  const applied = await withTenant(tenantId, async tx => {
    const [reservation] = await tx.insert(blueprintApplications).values({ tenantId, userId, idempotencyKey, blueprintHash, appliedBlueprint: normalized, result: {} }).onConflictDoNothing().returning({ id: blueprintApplications.id })
    if (!reservation) {
      const [existing] = await tx.select().from(blueprintApplications).where(and(eq(blueprintApplications.tenantId, tenantId), eq(blueprintApplications.idempotencyKey, idempotencyKey))).limit(1)
      if (!existing || existing.blueprintHash !== blueprintHash) throw createError({ statusCode: 409, statusMessage: 'Esta clave de idempotencia se usó con otro plano' })
      return existing.result as BlueprintApplyResult
    }
    const result: BlueprintApplyResult = { modules: [], fields: [], associations: [], layouts: [], workflows: [], merges: checked.merges }
    const ids = new Map((checked.current?.modules ?? []).map(module => [module.slug, module.id]))
    const newModules = normalized.modules.filter(module => module.action === 'create')
    for (const kind of ['dimension', 'hecho'] as const) for (const module of newModules.filter(item => item.kind === kind)) {
      const created = await createEntityInTx(tx, tenantId, { name: module.name, slug: module.slug, description: module.description ?? null, icon: module.icon ?? null, moduleKind: module.kind, singularName: module.singularName ?? null })
      ids.set(module.slug, created.id)
      result.modules.push({ id: created.id, slug: module.slug })
    }
    const newFields = normalized.modules.flatMap(module => (checked.newFields.get(module.ref) ?? []).map(field => ({ module, field })))
    const addField = async (module: Blueprint['modules'][number], field: BlueprintField) => {
      const entityId = ids.get(module.slug)!
      await createEntityFieldInTx(tx, tenantId, entityId, { name: field.name, label: field.label, dataType: field.dataType, isRequired: Boolean(field.required), validationRules: field.validationRules ?? {} })
      result.fields.push({ entityId, name: field.name })
    }
    for (const { module, field } of newFields.filter(item => item.field.dataType !== 'relation' && !item.field.validationRules?.calculation && item.field.dataType !== 'incremental')) await addField(module, field)
    for (const { module, field } of newFields.filter(item => item.field.dataType === 'relation')) await addField(module, field)
    // Incrementales con prefixSource dependen de una relación ya creada.
    for (const { module, field } of newFields.filter(item => item.field.dataType === 'incremental')) await addField(module, field)
    const associationNames = new Set((checked.current?.associations ?? []).map(item => item.name))
    for (const association of normalized.associations) {
      if (associationNames.has(association.name)) continue
      await createRelationDefinitionInTx(tx, tenantId, { name: association.name, sourceEntityId: ids.get(association.sourceRef)!, targetEntityId: ids.get(association.targetRef)! })
      result.associations.push(association.name)
    }
    const pending = newFields.filter(item => Boolean(item.field.validationRules?.calculation))
    while (pending.length) {
      const next = pending.findIndex(({ module, field }) => {
        const calculation = field.validationRules?.calculation as Record<string, unknown>
        const dependencies = calculation.kind === 'formula' ? [String(calculation.leftField), String(calculation.rightField)]
          : calculation.kind === 'expression' ? [...collectFieldRefs(parseExpression(String(calculation.expression)))]
          : calculation.aggregate === 'count' ? [] : [String(calculation.valueField)]
        const sourceSlug = calculation.kind === 'rollup' ? String(calculation.sourceEntity) : module.slug
        return dependencies.every(name => !pending.some(item => item.module.slug === sourceSlug && item.field.name === name))
      })
      if (next < 0) throw createError({ statusCode: 422, statusMessage: 'Hay una dependencia circular entre campos calculados' })
      const [{ module, field }] = pending.splice(next, 1)
      await addField(module, field)
    }
    for (const module of normalized.modules) {
      const desiredLines = module.lines ?? []
      if (!desiredLines.length) continue
      const [entity] = await tx.select({ detailLayout: entities.detailLayout }).from(entities).where(and(eq(entities.id, ids.get(module.slug)!), eq(entities.tenantId, tenantId))).limit(1)
      const parsed = detailLayoutSchema.safeParse(entity?.detailLayout)
      const old = parsed.success ? parsed.data : { properties: [], relations: [], showActivity: false }
      const allFields = await tx.select({ name: entityFields.name }).from(entityFields).where(eq(entityFields.entityId, ids.get(module.slug)!))
      const relations = [...old.relations]
      for (const line of desiredLines) if (!relations.some(relation => relation.entitySlug === line.childRef && relation.fieldName === line.relationField && relation.editable && JSON.stringify(relation.totals ?? []) === JSON.stringify(line.totals ?? []))) {
        const existingIndex = relations.findIndex(relation => relation.entitySlug === line.childRef && relation.fieldName === line.relationField)
        const value = { entitySlug: line.childRef, fieldName: line.relationField, visible: true, editable: true, ...(line.totals ? { totals: line.totals } : {}) }
        if (existingIndex >= 0) relations[existingIndex] = value
        else relations.push(value)
      }
      const layout = { properties: old.properties.length ? old.properties : allFields.map(field => ({ name: field.name, visible: true })), relations, showActivity: old.showActivity }
      if (!isDeepStrictEqual(layout, entity?.detailLayout)) {
        await updateEntityInTx(tx, tenantId, ids.get(module.slug)!, { detailLayout: layout })
        result.layouts.push(module.slug)
      }
    }
    for (const module of normalized.modules) {
      if (!module.workflow) continue
      const [entity] = await tx.select({ workflowConfig: entities.workflowConfig }).from(entities).where(and(eq(entities.id, ids.get(module.slug)!), eq(entities.tenantId, tenantId))).limit(1)
      if (entity?.workflowConfig) continue
      await validateWorkflowConfig(tx, tenantId, ids.get(module.slug)!, module.workflow)
      await updateEntityInTx(tx, tenantId, ids.get(module.slug)!, { workflowConfig: module.workflow })
      result.workflows.push(module.slug)
    }
    await tx.update(blueprintApplications).set({ result }).where(eq(blueprintApplications.id, reservation.id))
    return result
  })
  invalidateTenantAccess(tenantId)
  for (const item of applied.fields) invalidateEntitySchemaCache(tenantId, item.entityId)
  return applied
}
