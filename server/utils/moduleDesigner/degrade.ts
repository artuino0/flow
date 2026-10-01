import type { Blueprint } from '~/server/utils/blueprint/schema'
import type { BlueprintValidationError } from '~/server/utils/blueprint/validate'

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Solo campos nuevos; el llamador debe revalidar antes de publicar esta copia. */
export function degradeDesignerFields(input: unknown, errors: BlueprintValidationError[], current: Blueprint) {
  const blueprint: unknown = structuredClone(input)
  const warnings: string[] = []
  if (!record(blueprint) || !Array.isArray(blueprint.modules)) return { blueprint, warnings }
  const removals = new Map<Record<string, unknown>, Set<unknown>>()
  for (const error of errors) {
    const match = /^modules\[(\d+)\]\.fields\[(\d+)\]\.validationRules(?:\.([^.[\]]+))?/.exec(error.path)
    if (!match || error.message.includes('dependencia circular')) continue
    const fieldPath = `modules[${match[1]}].fields[${match[2]}]`
    if (errors.some(item => item.path.startsWith(`${fieldPath}.`) && item.message.includes('dependencia circular'))) continue
    const module = blueprint.modules[Number(match[1])]
    if (!record(module) || !Array.isArray(module.fields)) continue
    const field = module.fields[Number(match[2])]
    if (!record(field)) continue
    if (current.modules.find(item => item.slug === module.slug)?.fields.some(item => item.name === field.name)) continue
    const rules = record(field.validationRules) ? field.validationRules : {}
    const key = error.ruleKey ?? match[3]
    const name = String(field.label ?? field.name)
    const where = `En ${String(module.name)}, `
    if (key === 'calculation' && 'calculation' in rules) {
      delete rules.calculation
      warnings.push(`${where}dejé «${name}» como campo simple de tipo ${String(field.dataType)} porque no pude configurar su cálculo; puedes pedírmelo de nuevo o configurarlo en Campos.`)
    } else if (key && key in rules && !['relationEntity', 'options', 'columns', 'digits'].includes(key)) {
      delete rules[key]
      warnings.push(`${where}quité la regla ${key} de «${name}» porque no es válida para este campo; puedes configurarla en Campos.`)
    } else {
      if (!removals.has(module)) removals.set(module, new Set())
      const removed = removals.get(module)!
      if (!removed.has(field)) warnings.push(`${where}omití el campo «${name}» porque sus reglas o su relación no se pudieron configurar de forma segura; puedes volver a pedirlo o crearlo en Campos.`)
      removed.add(field)
    }
  }
  for (const [module, removed] of removals) module.fields = (module.fields as unknown[]).filter(field => !removed.has(field))
  return { blueprint, warnings }
}
