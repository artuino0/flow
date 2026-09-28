import type { Blueprint } from '~/server/utils/blueprint/schema'

const SYSTEM_USER_REFS = new Set(['system:users', 'usuarios', 'users', 'sistema-usuarios'])

/** Quita vínculos redundantes de respuestas de IA sin ocultar auto-asociaciones inválidas. */
export function normalizeDesignerAssociations(input: unknown): { blueprint: unknown; warnings: string[] } {
  if (!input || typeof input !== 'object') return { blueprint: input, warnings: [] }
  const blueprint = structuredClone(input) as Partial<Blueprint>
  if (!Array.isArray(blueprint.modules) || !Array.isArray(blueprint.associations)) return { blueprint: input, warnings: [] }
  const modules = blueprint.modules.filter(module => module && typeof module.ref === 'string' && typeof module.slug === 'string')
  const byRef = new Map(modules.flatMap(module => [[module.ref, module.slug], [module.slug, module.slug]]))
  const key = (ref: string) => byRef.get(ref) ?? ref
  const systemRef = (ref: string) => !byRef.has(ref) && SYSTEM_USER_REFS.has(ref.toLowerCase())
  const warnings: string[] = []
  blueprint.associations = blueprint.associations.filter(association => {
    if (!association || typeof association.sourceRef !== 'string' || typeof association.targetRef !== 'string') return true
    const source = key(association.sourceRef)
    const target = key(association.targetRef)
    if (source === target) return true
    const duplicate = modules.find(module => {
      if (module.slug !== source && module.slug !== target) return false
      const other = module.slug === source ? target : source
      return Array.isArray(module.fields) && module.fields.some(field =>
        field?.dataType === 'relation' && typeof field.validationRules?.relationEntity === 'string'
          && key(field.validationRules.relationEntity) === other
          || field?.dataType === 'user' && systemRef(module.slug === source ? association.targetRef : association.sourceRef)
      )
    })
    if (!duplicate) return true
    warnings.push(`Omití la asociación «${association.name}» porque ese vínculo ya está expresado por un campo relación o Usuario.`)
    return false
  })
  return { blueprint, warnings }
}
