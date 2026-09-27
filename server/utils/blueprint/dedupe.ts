import type { Blueprint } from './schema'
import type { loadBlueprintTenant } from './export'

type TenantShape = Awaited<ReturnType<typeof loadBlueprintTenant>>
export interface BlueprintMerge { from: string; to: string; message: string; discardedFields: string[] }

export function normalizeBlueprintName(value: string): string {
  let name = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ')
  return name.split(' ').map(word => {
    if (word.endsWith('ces') && word.length > 4) return `${word.slice(0, -3)}z`
    if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
    if (word.endsWith('s') && word.length > 3) return word.slice(0, -1)
    return word
  }).join(' ')
}

function redirect(blueprint: Blueprint, aliases: Map<string, string>) {
  const resolve = (ref: string) => aliases.get(ref) ?? ref
  for (const module of blueprint.modules) {
    module.lines?.forEach(line => { line.childRef = resolve(line.childRef) })
    module.detailLayout?.relations.forEach(relation => { relation.entitySlug = resolve(relation.entitySlug) })
    module.workflow?.rules?.forEach(rule => { if (rule.type !== 'required') rule.lineEntity = resolve(rule.lineEntity) })
    for (const field of module.fields) {
      const rules = field.validationRules
      if (!rules) continue
      if (typeof rules.relationEntity === 'string') rules.relationEntity = resolve(rules.relationEntity)
      if (Array.isArray(rules.columns)) for (const column of rules.columns) {
        if (column && typeof column === 'object' && typeof column.relationEntity === 'string') column.relationEntity = resolve(column.relationEntity)
      }
      const calculation = rules.calculation as Record<string, unknown> | undefined
      if (calculation && typeof calculation === 'object' && calculation.kind === 'rollup' && typeof calculation.sourceEntity === 'string') calculation.sourceEntity = resolve(calculation.sourceEntity)
    }
  }
  for (const association of blueprint.associations) {
    association.sourceRef = resolve(association.sourceRef)
    association.targetRef = resolve(association.targetRef)
  }
}

export function dedupeBlueprint(input: Blueprint, current: TenantShape): { normalized: Blueprint; merges: BlueprintMerge[] } {
  const normalized: Blueprint = structuredClone(input)
  const merges: BlueprintMerge[] = []
  const aliases = new Map<string, string>()
  for (const module of normalized.modules) {
    if (module.action !== 'create') continue
    const proposedNames = new Set([module.name, module.singularName ?? ''].filter(Boolean).map(normalizeBlueprintName))
    const proposedFields = new Set(module.fields.map(field => normalizeBlueprintName(field.name)))
    const match = current.modules.find(existing => {
      if (existing.moduleKind !== module.kind) return false
      if (existing.slug === module.slug) return true
      if ([existing.name, existing.singularName ?? ''].filter(Boolean).some(name => proposedNames.has(normalizeBlueprintName(name)))) return true
      const fields = current.fieldsById.get(existing.id) ?? []
      const equal = fields.filter(field => proposedFields.has(normalizeBlueprintName(field.name))).length
      return proposedFields.size > 0 && fields.length > 0 && equal / Math.max(proposedFields.size, fields.length) >= 0.6
    })
    if (!match) continue
    const existingFields = new Set((current.fieldsById.get(match.id) ?? []).map(field => normalizeBlueprintName(field.name)))
    const discardedFields = module.fields.filter(field => existingFields.has(normalizeBlueprintName(field.name))).map(field => field.name)
    module.fields = module.fields.filter(field => !existingFields.has(normalizeBlueprintName(field.name)))
    module.action = 'extend'
    module.slug = match.slug
    module.name = match.name
    module.kind = match.moduleKind === 'dimension' ? 'dimension' : 'hecho'
    if (module.workflow && match.workflowConfig) module.workflow = undefined
    aliases.set(module.ref, match.slug)
    aliases.set(input.modules.find(item => item.ref === module.ref)?.slug ?? module.ref, match.slug)
    merges.push({ from: module.ref, to: match.slug, discardedFields, message: `Usé tu módulo ${match.name} existente en lugar de crear uno nuevo` })
  }
  redirect(normalized, aliases)
  return { normalized, merges }
}
