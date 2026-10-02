import type { Blueprint, BlueprintField, BlueprintModule } from '~/server/utils/blueprint/schema'
import type { validateBlueprint } from '~/server/utils/blueprint/validate'
import { designerCoverageWarnings, designerRequestedItems, normalizeCoverageName } from './coverage'
import { applyDesignerPatch, type DesignerPatch } from './patch'

export type DesignerReviewFinding = {
  rule: 'orphan-catalog' | 'stage-as-relation' | 'kanban-needs-select' | 'dangling-reference' | 'redundant-duplicate'
  severity: 'info' | 'warning'
  target: { slug: string; field?: string }
  message: string
  fix?: { remove: { slug: string; field?: string } }
}
export type DesignerReviewSummary = { extraCall: boolean; adopted: boolean; autoFixes: number; rules: string[] }
const normalized = normalizeCoverageName
const stage = (name: string) => /^(etapa|estado|estatu|statu|fase)(?: |$)/.test(normalized(name))
const boardRequest = (instruction: string) => /\b(embudo|kanban|tablero|pipeline|etapas?)\b/.test(normalized(instruction))
const usableSelect = (field: BlueprintField) => field.dataType === 'select' && Array.isArray(field.validationRules?.options) && field.validationRules.options.length > 0
const stateSelect = (module: BlueprintModule) => module.fields.find(field => usableSelect(field) && (stage(field.label) || stage(field.name) || module.workflow?.field === field.name))
const stageCatalogFor = (catalog: BlueprintModule, module: BlueprintModule) => {
  const qualifier = normalized(catalog.name).split(' ').slice(1).join(' ')
  return stage(catalog.name) && (!qualifier || ['embudo', 'proceso', 'pipeline', 'venta'].includes(qualifier) || qualifier === normalized(module.name) || qualifier === normalized(module.slug))
}
const newModule = (module: BlueprintModule, current: Blueprint) => module.action === 'create' && !module.snapshot && !current.modules.some(existing => existing.slug === module.slug)
const newField = (module: BlueprintModule, field: BlueprintField, current: Blueprint) => !current.modules.find(existing => existing.slug === module.slug)?.fields.some(existing => existing.name === field.name)

/** Conservador: protege cualquier nombre mencionado, además de las listas explícitas de HU-149. */
export function explicitlyRequested(name: string, instruction: string) {
  const key = normalized(name)
  return Boolean(key && (` ${normalized(instruction)} `).includes(` ${key} `)) || designerRequestedItems(instruction).some(item => normalized(item.item) === key)
}
const independentCatalog = (module: BlueprintModule, instruction: string) => instruction.split(/[\n.;]/).some(line => explicitlyRequested(module.name, line) && /\b(independiente|suelto|sin vincular|sin relacion|sin usar)\b/.test(normalized(line)))
const optionsKey = (field: BlueprintField) => Array.isArray(field.validationRules?.options) ? JSON.stringify(field.validationRules.options.map(option => typeof option === 'object' && option && 'value' in option ? String(option.value) : '').sort()) : null

/** Solo planos válidos. Relaciones, asociaciones y rollups rotos ya los rechaza validateBlueprint.
 * copyFrom de columnas es metadata no comprobada allí: solo interpretamos entidad.campo.
 * No inferimos los registros/opciones de un catálogo a partir de etiquetas o descripciones.
 */
export function reviewDesignerBlueprint(blueprint: Blueprint, current: Blueprint, instruction: string): DesignerReviewFinding[] {
  const findings: DesignerReviewFinding[] = []
  const modules = [...blueprint.modules, ...current.modules.filter(existing => !blueprint.modules.some(module => module.slug === existing.slug))]
  const resolve = (ref: unknown) => modules.find(module => module.slug === ref || module.ref === ref)
  const children = new Set(blueprint.modules.flatMap(module => module.lines?.map(line => resolve(line.childRef)?.slug) ?? []))
  const candidates = blueprint.modules.filter(module => module.kind === 'hecho' && !children.has(module.slug))
  const named = candidates.filter(module => explicitlyRequested(module.name, instruction) || explicitlyRequested(module.slug, instruction))
  // No adivinamos el módulo principal cuando hay varios candidatos sin nombre explícito.
  const main = named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : undefined
  for (const module of blueprint.modules) {
    if (module.kind === 'dimension' && newModule(module, current)) {
      const connected = modules.some(source => source.fields.some(field => field.dataType === 'relation' && resolve(field.validationRules?.relationEntity)?.slug === module.slug))
      if (!connected && !independentCatalog(module, instruction)) {
        const duplicate = modules.find(source => source.kind === 'hecho' && stateSelect(source) && stageCatalogFor(module, source))
        const canRemove = duplicate && !explicitlyRequested(module.name, instruction) && !explicitlyRequested(module.slug, instruction)
        findings.push({ rule: 'orphan-catalog', severity: 'info', target: { slug: module.slug }, message: duplicate ? `Creé «${module.name}», pero ningún campo lo usa; la etapa ya vive como estado de «${duplicate.name}».` : `Creé «${module.name}», pero ningún campo lo usa.`, ...(canRemove ? { fix: { remove: { slug: module.slug } } } : {}) })
      }
      for (const field of module.fields.filter(usableSelect)) {
        const duplicate = blueprint.modules.find(source => source !== module && source.fields.some(other => newField(source, other, current) && usableSelect(other) && normalized(other.label) === normalized(field.label) && optionsKey(other) === optionsKey(field)))
        if (duplicate) findings.push({ rule: 'redundant-duplicate', severity: 'info', target: { slug: module.slug }, message: `«${module.name}» y «${duplicate.name}» repiten las mismas opciones de «${field.label}».` })
      }
    }
    for (const [index, field] of module.fields.entries()) {
      if (!newField(module, field, current)) continue
      const target = resolve(field.validationRules?.relationEntity)
      if (field.dataType === 'relation' && target?.kind === 'dimension' && stageCatalogFor(target, module) && module.kind === 'hecho' && (boardRequest(instruction) && (main === module || explicitlyRequested(module.name, instruction)) || module.workflow)) {
        findings.push({ rule: 'stage-as-relation', severity: stateSelect(module) ? 'info' : 'warning', target: { slug: module.slug, field: field.name }, message: `«${field.label}» en «${module.name}» usa un catálogo de etapas; Flow solo agrupa el tablero por un campo Select.${stateSelect(module) ? ' Ya hay un Select de estado utilizable.' : ''}` })
      }
      const prior = module.fields.slice(0, index).find(other => normalized(other.name) === normalized(field.name))
      if (prior) {
        const shape = ({ name: _name, label: _label, ...rest }: BlueprintField) => JSON.stringify(rest)
        const exact = normalized(prior.label) === normalized(field.label) && shape(prior) === shape(field)
        const protectedName = explicitlyRequested(field.name, instruction) || explicitlyRequested(field.label, instruction)
        findings.push({ rule: 'redundant-duplicate', severity: 'info', target: { slug: module.slug, field: field.name }, message: `«${field.label}» repite el campo «${prior.label}» en «${module.name}».`, ...(exact && !protectedName && prior.name !== field.name ? { fix: { remove: { slug: module.slug, field: field.name } } } : {}) })
      }
      const columns = field.validationRules?.columns
      if (field.dataType === 'tabla' && Array.isArray(columns)) for (const column of columns) {
        if (!column || typeof column !== 'object' || !('copyFrom' in column) || typeof column.copyFrom !== 'string') continue
        const parts = column.copyFrom.split('.')
        if (parts.length !== 2) continue // Formatos ambiguos no se interpretan.
        const source = resolve(parts[0])
        if (!source?.fields.some(other => other.name === parts[1])) findings.push({ rule: 'dangling-reference', severity: 'warning', target: { slug: module.slug, field: field.name }, message: `La copia de datos de «${field.label}» en «${module.name}» apunta a un campo inexistente.` })
      }
    }
  }
  if (boardRequest(instruction) && main && !stateSelect(main) && (!current.modules.some(module => module.slug === main.slug) || main.fields.some(field => newField(main, field, current)))) findings.push({ rule: 'kanban-needs-select', severity: 'warning', target: { slug: main.slug }, message: `Para ver «${main.name}» como tablero necesita un campo Select de estado.` })
  return findings
}

/** Un parche dirigido solo puede añadir el Select requerido o editar el campo exacto reportado. */
export function reviewPatchInScope(patch: DesignerPatch, findings: DesignerReviewFinding[], blueprint: Blueprint) {
  return patch.operations.every(operation => findings.some(finding => {
    if (!('slug' in operation) || operation.slug !== finding.target.slug) return false
    if (finding.rule === 'kanban-needs-select') return operation.op === 'addField' && usableSelect(operation.field) && stage(operation.field.label)
    if (finding.rule !== 'dangling-reference' || operation.op !== 'updateField' || operation.name !== finding.target.field || Object.keys(operation.changes).some(key => key !== 'validationRules')) return false
    const original = blueprint.modules.find(module => module.slug === operation.slug)?.fields.find(field => field.name === operation.name)?.validationRules
    const changed = operation.changes.validationRules
    if (!original || !changed) return false
    // Se permite reparar únicamente copyFrom, sin retirar columnas, opciones u otras reglas.
    const withoutCopies = (rules: Record<string, unknown>) => ({ ...rules, columns: Array.isArray(rules.columns) ? rules.columns.map(column => {
      if (!column || typeof column !== 'object') return column
      return Object.fromEntries(Object.entries(column).filter(([key]) => key !== 'copyFrom'))
    }) : rules.columns })
    return JSON.stringify(withoutCopies(original)) === JSON.stringify(withoutCopies(changed))
  }))
}

export function reviewDoesNotWorsen(before: Blueprint, after: Blueprint, current: Blueprint, instruction: string) {
  const previousCoverage = new Set(designerCoverageWarnings(instruction, before))
  if (designerCoverageWarnings(instruction, after).some(warning => !previousCoverage.has(warning))) return false
  const score = (blueprint: Blueprint) => reviewDesignerBlueprint(blueprint, current, instruction).filter(finding => finding.severity === 'warning').length
  return score(after) < score(before)
}

export async function autoFixDesignerReview(blueprint: Blueprint, current: Blueprint, instruction: string, validate: (proposal: unknown) => ReturnType<typeof validateBlueprint>) {
  let resultBlueprint = blueprint
  let validation: Awaited<ReturnType<typeof validateBlueprint>> | undefined
  const warnings: string[] = []
  for (const finding of reviewDesignerBlueprint(blueprint, current, instruction)) {
    if (!finding.fix) continue
    const { slug, field } = finding.fix.remove
    const module = resultBlueprint.modules.find(module => module.slug === slug)
    if (!module) continue
    const hasCopyReference = [...resultBlueprint.modules, ...current.modules].some(source => source.fields.some(sourceField => {
      const columns = sourceField.validationRules?.columns
      return Array.isArray(columns) && columns.some(column => {
        if (!column || typeof column !== 'object' || !('copyFrom' in column) || typeof column.copyFrom !== 'string') return false
        const [ref, name] = column.copyFrom.split('.')
        return [module.ref, module.slug].includes(ref ?? '') && (!field || name === field)
      })
    }))
    if (hasCopyReference) continue
    const applied = applyDesignerPatch(resultBlueprint, { message: 'Revisión de estructura', mode: 'patch', operations: [field ? { op: 'removeField', slug, name: field } : { op: 'removeModule', slug }] }, current)
    if (!applied.blueprint || applied.errors.length) continue
    // copyFrom no está cubierto por validateBlueprint: abortar si la eliminación lo rompe.
    const beforeDangling = reviewDesignerBlueprint(resultBlueprint, current, instruction).filter(item => item.rule === 'dangling-reference').length
    if (reviewDesignerBlueprint(applied.blueprint, current, instruction).filter(item => item.rule === 'dangling-reference').length > beforeDangling) continue
    const checked = await validate(applied.blueprint)
    if (!checked.normalized || checked.errors.length || checked.merges.length) continue
    const coverage = new Set(designerCoverageWarnings(instruction, resultBlueprint))
    if (designerCoverageWarnings(instruction, checked.normalized).some(warning => !coverage.has(warning))) continue
    resultBlueprint = checked.normalized
    validation = checked
    warnings.push(field ? `No repetí «${module.fields.find(item => item.name === field)?.label}» en «${module.name}»: ya está representado por otro campo idéntico.` : `No creé «${module.name}»: ningún campo lo usa y la etapa ya vive como estado en el plano.`)
  }
  return { blueprint: resultBlueprint, validation, warnings, findings: reviewDesignerBlueprint(resultBlueprint, current, instruction) }
}
