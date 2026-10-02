import type { Blueprint, BlueprintField } from '~/server/utils/blueprint/schema'
import type { FieldDraft } from '~/components/FieldFormModal.vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

export interface FieldFormSource {
  entities: Array<{ id: string; slug: string; name: string }>
  fieldsByEntity: Record<string, EntityFieldMeta[]>
}

export function blueprintFieldToDraft(field: BlueprintField): FieldDraft {
  return { name: field.name, label: field.label, dataType: field.dataType,
    isRequired: Boolean(field.required), isOwnerField: Boolean(field.isOwnerField),
    validationRules: JSON.parse(JSON.stringify(field.validationRules ?? {})) }
}

export function fieldDraftToBlueprint(draft: FieldDraft): BlueprintField {
  return { name: draft.name, label: draft.label, dataType: draft.dataType as BlueprintField['dataType'],
    required: draft.isRequired, isOwnerField: Boolean(draft.isOwnerField),
    validationRules: JSON.parse(JSON.stringify(draft.validationRules)) }
}

export function uniqueDesignerFieldName(fields: BlueprintField[]): string {
  const names = new Set(fields.map(field => field.name))
  let index = 1
  while (names.has(`nuevo_campo_${index}`)) index++
  return `nuevo_campo_${index}`
}

export function designerFieldIsEditable(current: Blueprint | null, slug: string, name: string): boolean {
  return current !== null && !current.modules.find(module => module.slug === slug)?.fields.some(field => field.name === name)
}

// La instantánea aporta los módulos existentes; la propuesta aporta los nuevos
// y las ampliaciones. No se sintetizan Usuarios ni campos reservados del lienzo.
export function designerFieldFormSource(current: Blueprint | null, working: Blueprint | null): FieldFormSource {
  const modules = new Map((current?.modules ?? []).map(module => [module.slug, module]))
  for (const module of working?.modules ?? []) {
    const fields = new Map((modules.get(module.slug)?.fields ?? []).map(field => [field.name, field]))
    for (const field of module.fields) fields.set(field.name, field)
    modules.set(module.slug, { ...module, fields: [...fields.values()] })
  }
  const entities = [...modules.values()].map(module => ({ id: module.slug, slug: module.slug, name: module.name }))
  const fieldsByEntity = Object.fromEntries([...modules.values()].map(module => [module.slug,
    module.fields.map(field => ({ ...blueprintFieldToDraft(field), id: `${module.slug}.${field.name}` }))]))
  // Normaliza referencias del plano a slugs también para prefijos, tablas y rollups.
  const slugs = new Map([...modules.values()].flatMap(module => [[module.ref, module.slug], [module.slug, module.slug]]))
  for (const fields of Object.values(fieldsByEntity)) for (const field of fields) {
    const rules = field.validationRules
    if (typeof rules.relationEntity === 'string') rules.relationEntity = slugs.get(rules.relationEntity) ?? rules.relationEntity
    if (Array.isArray(rules.columns)) for (const column of rules.columns) {
      if (column && typeof column === 'object') {
        if (typeof column.relationEntity === 'string') column.relationEntity = slugs.get(column.relationEntity) ?? column.relationEntity
        if (typeof column.copyFrom === 'string') {
          const dot = column.copyFrom.indexOf('.')
          if (dot > 0) column.copyFrom = `${slugs.get(column.copyFrom.slice(0, dot)) ?? column.copyFrom.slice(0, dot)}${column.copyFrom.slice(dot)}`
        }
      }
    }
    const calculation = rules.calculation as Record<string, unknown> | undefined
    if (typeof calculation?.sourceEntity === 'string') calculation.sourceEntity = slugs.get(calculation.sourceEntity) ?? calculation.sourceEntity
  }
  return { entities, fieldsByEntity }
}
