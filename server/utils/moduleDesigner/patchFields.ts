import type { ZodIssue } from 'zod'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { blueprintShapeErrors } from '~/server/utils/blueprint/validate'
import { degradeDesignerFields } from './degrade'

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Localiza las reglas de addModule/addField sin cambiar el contrato ni las defensas del parche. */
export function designerPatchFieldErrors(input: unknown, issues: ZodIssue[], base: Blueprint) {
  return issues.flatMap(issue => {
    if (!record(input) || !Array.isArray(input.operations)) return blueprintShapeErrors(input, [issue])
    const operation = input.operations[Number(issue.path[1])]
    if (!record(operation)) return blueprintShapeErrors(input, [issue])
    const module = operation.op === 'addModule' ? operation.module : operation.op === 'addField' ? { name: base.modules.find(item => item.slug === operation.slug)?.name ?? operation.slug, slug: operation.slug, fields: [operation.field] } : null
    if (!module) return blueprintShapeErrors(input, [issue])
    const suffix = issue.path.slice(3)
    const path = operation.op === 'addModule' ? ['modules', 0, ...suffix] : ['modules', 0, 'fields', 0, ...suffix]
    return blueprintShapeErrors({ modules: [module] }, [{ ...issue, path }]).map(error => ({ ...error, path: issue.path.reduce<string>((out, part) => typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : part, '') + (error.ruleKey && issue.path.at(-1) === 'validationRules' ? `.${error.ruleKey}` : '') }))
  })
}

export function degradeDesignerPatchFields(input: unknown, issues: ZodIssue[], base: Blueprint, current: Blueprint) {
  const patch: unknown = structuredClone(input)
  const warnings: string[] = []
  if (!record(patch) || !Array.isArray(patch.operations)) return { patch, warnings }
  const remove = new Set<unknown>()
  for (const [index, operation] of patch.operations.entries()) {
    if (!record(operation)) continue
    const relevant = issues.filter(issue => issue.path[0] === 'operations' && issue.path[1] === index)
    if (!relevant.length) continue
    const module = operation.op === 'addModule' ? operation.module : operation.op === 'addField' ? { name: base.modules.find(item => item.slug === operation.slug)?.name ?? operation.slug, slug: operation.slug, fields: [operation.field] } : null
    if (!module) continue
    const mapped = relevant.map(issue => ({ ...issue, path: operation.op === 'addModule' ? ['modules', 0, ...issue.path.slice(3)] : ['modules', 0, 'fields', 0, ...issue.path.slice(3)] }))
    const errors = blueprintShapeErrors({ modules: [module] }, mapped)
    const degraded = degradeDesignerFields({ modules: [module] }, errors, current)
    if (!degraded.warnings.length || !record(degraded.blueprint) || !Array.isArray(degraded.blueprint.modules)) continue
    const changed = degraded.blueprint.modules[0]
    if (!record(changed) || !Array.isArray(changed.fields)) continue
    warnings.push(...degraded.warnings)
    if (operation.op === 'addModule') operation.module = changed
    else if (changed.fields.length) operation.field = changed.fields[0]
    else remove.add(operation)
  }
  patch.operations = patch.operations.filter(operation => !remove.has(operation))
  return { patch, warnings }
}
