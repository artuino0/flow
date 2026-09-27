import { blueprintPlanImpact } from './plan'
import type { BlueprintValidationResult } from './validate'

export async function diffBlueprint(tenantId: string, result: BlueprintValidationResult) {
  const blueprint = result.normalized
  const current = result.current
  const modules = blueprint?.modules ?? []
  const newModules = modules.filter(module => module.action === 'create' && module.kind === 'hecho').map(module => ({ slug: module.slug, name: module.name }))
  const newCatalogs = modules.filter(module => module.action === 'create' && module.kind === 'dimension').map(module => ({ slug: module.slug, name: module.name }))
  const extendedModules = modules.filter(module => module.action === 'extend' && (result.newFields.get(module.ref)?.length ?? 0) > 0)
    .map(module => ({ slug: module.slug, fields: result.newFields.get(module.ref)!.map(field => field.name) }))
  const oldFields = new Set((current?.modules ?? []).flatMap(module => (current?.fieldsById.get(module.id) ?? []).filter(field => field.dataType === 'relation').map(field => `${module.slug}.${field.name}`)))
  const relations = modules.flatMap(module => (result.newFields.get(module.ref) ?? []).filter(field => field.dataType === 'relation' && !oldFields.has(`${module.slug}.${field.name}`)).map(field => ({ source: module.slug, field: field.name, target: (field.validationRules as { relationEntity?: string } | undefined)?.relationEntity ?? '' })))
  const oldAssociations = new Set(current?.associations.map(association => association.name) ?? [])
  const associations = (blueprint?.associations ?? []).filter(association => !oldAssociations.has(association.name))
  const states = modules.filter(module => module.workflow && !current?.modules.find(item => item.slug === module.slug)?.workflowConfig).map(module => ({ slug: module.slug, states: Object.keys(module.workflow!.states) }))
  const plan = await blueprintPlanImpact(tenantId, newModules.length)
  return { newModules, extendedModules, newCatalogs, relations, associations, states, merges: result.merges, plan }
}
