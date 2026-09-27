import { blueprintSchema, type Blueprint } from '~/server/utils/blueprint/schema'
import { normalizeBlueprintName, type BlueprintMerge } from '~/server/utils/blueprint/dedupe'

/** Se usa solo después de pedir a la IA que corrija; la API de planos conserva su validación estricta. */
export function mergeDesignerFields(input: unknown, current: Blueprint): { blueprint: unknown; merges: BlueprintMerge[] } {
  const parsed = blueprintSchema.safeParse(input)
  if (!parsed.success) return { blueprint: input, merges: [] }
  const blueprint = structuredClone(parsed.data)
  const merges: BlueprintMerge[] = []
  for (const module of blueprint.modules) {
    const existing = module.action === 'extend' ? current.modules.find(item => item.slug === module.slug) : undefined
    const oldFields = existing?.fields ?? []
    const oldByName = new Map(oldFields.map(field => [normalizeBlueprintName(field.name), field.name]))
    const oldExact = new Set(oldFields.map(field => field.name))
    const seen = new Map<string, string>()
    module.fields = module.fields.filter(field => {
      const key = normalizeBlueprintName(field.name)
      const old = oldByName.get(key)
      if (module.snapshot && oldExact.has(field.name)) { seen.set(key, field.name); return true }
      const reused = old ?? seen.get(key)
      if (!reused) { seen.set(key, field.name); return true }
      merges.push({ from: `${module.ref}.${field.name}`, to: `${module.slug}.${reused}`, discardedFields: [field.name], message: `Usé tu campo ${reused} existente en ${module.name} en lugar de agregar ${field.name} otra vez` })
      return false
    })
  }
  return { blueprint, merges }
}
