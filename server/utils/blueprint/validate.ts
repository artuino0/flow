import { eq } from 'drizzle-orm'
import type { ZodIssue } from 'zod'
import { withTenant } from '~/server/db'
import { roles } from '~/server/db/schema'
import { collectFieldRefs, parseExpression } from '~/utils/calcExpression'
import { MODULE_ICON_KEY_SET } from '~/server/utils/moduleIcons'
import { detailLayoutSchema } from '~/server/utils/detailLayout'
import { calendarConfigSchema } from '~/server/utils/calendarConfig'
import { SLUG_PATTERN } from '~/server/utils/moduleEntities'
import { blueprintSchema, type Blueprint, type BlueprintField } from './schema'
import { dedupeBlueprint, type BlueprintMerge } from './dedupe'
import { loadBlueprintTenant, type BlueprintTx } from './export'
import { blueprintPlanImpact } from './plan'
import { STALE_DESIGN_MESSAGE } from '~/server/utils/moduleDesigner/resync'
import { locateBlueprintError } from './validationErrors'

export interface BlueprintValidationError { path: string; message: string; code?: string; dataType?: string; ruleKey?: string; moduleName?: string; fieldName?: string }
export interface BlueprintValidationResult { normalized: Blueprint | null; errors: BlueprintValidationError[]; merges: BlueprintMerge[]; current: Awaited<ReturnType<typeof loadBlueprintTenant>> | null; newFields: Map<string, BlueprintField[]> }

const FIELD_PATTERN = /^[a-z][a-z0-9_]*$/
const RESERVED = new Set(['id', 'api', 'admin', 'platform', 'auth', 'records', 'entities', 'blueprints'])
const rulesOf = (field: { validationRules?: unknown }) => (field.validationRules ?? {}) as Record<string, unknown>
const canon = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
const pathOf = (parts: Array<string | number>) => parts.reduce<string>((path, part) => typeof part === 'number' ? `${path}[${part}]` : path ? `${path}.${part}` : part, '')
const issueMessage = (issue: ZodIssue): string => {
  if (issue.code === 'invalid_type') return issue.received === 'undefined' ? 'Este valor es obligatorio' : 'El tipo de dato no es válido'
  if (issue.code === 'unrecognized_keys') return 'La regla contiene propiedades que este tipo de campo no admite'
  if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_literal' || issue.code === 'invalid_union' || issue.code === 'invalid_union_discriminator') return 'El valor no está permitido'
  if (issue.code === 'too_small') return issue.type === 'string' && issue.minimum === 1 ? 'Este texto es obligatorio y no puede estar vacío' : 'El valor es menor al mínimo permitido'
  if (issue.code === 'too_big') return 'El valor supera el máximo permitido'
  if (issue.code === 'custom' && issue.params?.ruleCode && issue.params.ruleCode !== 'custom') return issue.params.ruleCode === 'unrecognized_keys' ? 'Este tipo de campo no admite esa regla' : 'La regla debe usar el tipo, las opciones y los valores permitidos para este campo'
  if (issue.code === 'invalid_string') return 'El formato del texto no es válido'
  return issue.message
}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

function invalidBlueprintShape(issues: ZodIssue[], input: unknown): BlueprintValidationResult {
  return { normalized: null, errors: issues.flatMap(issue => {
    const keys: string[] = issue.code === 'custom' ? issue.params?.ruleKeys ?? [] : []
    return (keys.length ? keys : [undefined]).map(ruleKey => locateBlueprintError(input, { path: pathOf([...issue.path, ...(ruleKey ? [ruleKey] : [])]), code: issue.code === 'custom' ? issue.params?.ruleCode ?? issue.code : issue.code, message: issueMessage(issue), ...(ruleKey ? { ruleKey } : {}) }))
  }), merges: [], current: null, newFields: new Map() }
}

export function blueprintShapeErrors(input: unknown, issues: ZodIssue[]) {
  return invalidBlueprintShape(issues, input).errors
}

async function validateBlueprintAgainstCurrent(input: Blueprint, current: Awaited<ReturnType<typeof loadBlueprintTenant>>, knownRoles: Set<string>): Promise<BlueprintValidationResult> {
  const { normalized, merges } = dedupeBlueprint(input, current)
  const errors: BlueprintValidationError[] = []
  const add = (path: string, message: string, code = 'reference') => errors.push(locateBlueprintError(normalized, { path, message, code }))
  const bySlug = new Map(current.modules.map(module => [module.slug, module]))
  const refs = new Map<string, Blueprint['modules'][number]>()
  const proposedSlugs = new Set<string>()
  const mergeRefs = new Set(merges.map(merge => merge.from))
  let creates = 0
  for (const [index, module] of normalized.modules.entries()) {
    const base = `modules[${index}]`
    if (refs.has(module.ref)) add(`${base}.ref`, 'La referencia del módulo está repetida')
    refs.set(module.ref, module)
    if (module.action === 'create') {
      creates++
      module.slug = canon(module.slug)
      if (!SLUG_PATTERN.test(module.slug) || RESERVED.has(module.slug)) add(`${base}.slug`, 'El slug es inválido o reservado')
      if (bySlug.has(module.slug)) {
        let suffix = 2
        while (bySlug.has(`${module.slug}-${suffix}`) || proposedSlugs.has(`${module.slug}-${suffix}`)) suffix++
        module.slug = `${module.slug}-${suffix}`
      }
      if (proposedSlugs.has(module.slug)) add(`${base}.slug`, 'El slug está repetido dentro del plano')
      proposedSlugs.add(module.slug)
    } else {
      const existing = bySlug.get(module.slug)
      if (!existing) {
        if (!errors.some(error => error.code === 'stale_blueprint')) add('modules', STALE_DESIGN_MESSAGE, 'stale_blueprint')
      } else if (existing.moduleKind !== module.kind) add(`${base}.kind`, 'El tipo del módulo existente no coincide')
      if (module.workflow && existing?.workflowConfig && !(module.snapshot && same(module.workflow, existing.workflowConfig))) add(`${base}.workflow`, 'El módulo ya tiene un flujo de estados y no se puede reemplazar')
      if (module.snapshot && existing && (module.name !== existing.name || (module.singularName ?? null) !== existing.singularName || (module.description ?? null) !== existing.description || (module.icon ?? null) !== existing.icon)) add(base, 'La instantánea cambia propiedades existentes del módulo')
      if (module.detailLayout && !module.snapshot) add(`${base}.detailLayout`, 'El diseño de detalle solo se incluye en una instantánea; usa lines para agregar partidas')
      if (module.detailLayout && module.snapshot && existing) {
        const layout = detailLayoutSchema.safeParse(existing.detailLayout)
        if (!layout.success || !same(module.detailLayout, layout.data)) add(`${base}.detailLayout`, 'La instantánea modifica el diseño de detalle existente')
      }
      if (module.calendarConfig && !module.snapshot) add(`${base}.calendarConfig`, 'El calendario solo se incluye en una instantánea del módulo')
      if (module.calendarConfig && module.snapshot && existing) {
        const calendar = calendarConfigSchema.safeParse(existing.calendarConfig)
        if (!calendar.success || !same(module.calendarConfig, calendar.data)) add(`${base}.calendarConfig`, 'La instantánea modifica la configuración de calendario existente')
      }
    }
    if (module.icon && !MODULE_ICON_KEY_SET.has(module.icon)) add(`${base}.icon`, 'El icono no existe')
    if (module.action === 'create' && RESERVED.has(canon(module.name))) add(`${base}.name`, 'El nombre del módulo está reservado')
    if (module.fields.length > 40 && module.action === 'create') add(`${base}.fields`, 'Un módulo nuevo admite como máximo 40 campos')
    if (module.workflow && Object.keys(module.workflow.states).length > 10) add(`${base}.workflow.states`, 'Un flujo admite como máximo 10 estados')
    const names = new Set<string>()
    const existingFields = current.fieldsById.get(bySlug.get(module.slug)?.id ?? '') ?? []
    const newFields: BlueprintField[] = []
    for (const [fieldIndex, field] of module.fields.entries()) {
      const at = `${base}.fields[${fieldIndex}]`
      if (!FIELD_PATTERN.test(field.name) || field.name === 'id') add(`${at}.name`, 'El nombre técnico del campo es inválido o reservado')
      if (names.has(field.name)) add(`${at}.name`, 'El campo está repetido en el módulo')
      names.add(field.name)
      const existingField = existingFields.find(item => item.name === field.name)
      if (existingField) {
        if (!module.snapshot && !mergeRefs.has(module.ref)) add(`${at}.name`, 'El campo ya existe en el módulo')
        if (module.snapshot && (existingField.label !== field.label || existingField.dataType !== field.dataType || existingField.isRequired !== Boolean(field.required) || existingField.isOwnerField !== Boolean(field.isOwnerField) || !same(existingField.validationRules, field.validationRules ?? {}))) add(at, 'La instantánea modifica un campo existente')
      } else newFields.push(field)
    }
    if (newFields.length > 40) add(`${base}.fields`, 'Se pueden agregar como máximo 40 campos por módulo')
    if (module.snapshot && module.action === 'extend' && existingFields.some(field => !names.has(field.name))) add(`${base}.fields`, 'La instantánea omite campos existentes')
  }
  if (creates > 15) add('modules', 'Un plano admite como máximo 15 módulos nuevos')
  const resolve = (ref: string) => refs.get(ref) ?? normalized.modules.find(module => module.slug === ref)
  const target = (ref: string) => resolve(ref)?.slug ?? (bySlug.has(ref) ? ref : null)
  for (const module of normalized.modules) {
    for (const line of module.lines ?? []) line.childRef = target(line.childRef) ?? line.childRef
    module.detailLayout?.relations.forEach(relation => { relation.entitySlug = target(relation.entitySlug) ?? relation.entitySlug })
    module.workflow?.rules?.forEach(rule => { if (rule.type !== 'required') rule.lineEntity = target(rule.lineEntity) ?? rule.lineEntity })
    for (const field of module.fields) {
      const rules = rulesOf(field)
      if (typeof rules.relationEntity === 'string') rules.relationEntity = target(rules.relationEntity) ?? rules.relationEntity
      if (Array.isArray(rules.columns)) for (const column of rules.columns) if (column && typeof column === 'object' && typeof column.relationEntity === 'string') column.relationEntity = target(column.relationEntity) ?? column.relationEntity
      const calc = rules.calculation as Record<string, unknown> | undefined
      if (calc?.kind === 'rollup' && typeof calc.sourceEntity === 'string') calc.sourceEntity = target(calc.sourceEntity) ?? calc.sourceEntity
    }
  }
  const fieldsFor = (slug: string) => {
    const proposal = normalized.modules.find(module => module.slug === slug)
    const old = current.fieldsById.get(bySlug.get(slug)?.id ?? '') ?? []
    return [...old.map(field => ({ name: field.name, dataType: field.dataType, validationRules: field.validationRules })), ...(proposal?.fields ?? [])]
  }
  const fieldFor = (slug: string, name: string) => fieldsFor(slug).find(field => field.name === name)
  for (const [index, module] of normalized.modules.entries()) {
    const base = `modules[${index}]`
    if (module.calendarConfig?.enabled) {
      const config = module.calendarConfig
      const startDate = config.startDateField ? fieldFor(module.slug, config.startDateField) : null
      if (startDate?.dataType !== 'date') add(`${base}.calendarConfig.startDateField`, 'El calendario requiere un campo de fecha existente')
      const checkType = (name: string | null, allowed: string[], part: string) => {
        if (name && !allowed.includes(fieldFor(module.slug, name)?.dataType ?? '')) add(`${base}.calendarConfig.${part}`, 'El campo no existe o no es compatible')
      }
      checkType(config.startTimeField, ['text', 'datetime'], 'startTimeField')
      checkType(config.durationField, ['number'], 'durationField')
      checkType(config.endField, ['text', 'datetime'], 'endField')
      if (config.titleField && !fieldFor(module.slug, config.titleField)) add(`${base}.calendarConfig.titleField`, 'El campo de título no existe')
      checkType(config.colorField, ['select'], 'colorField')
      checkType(config.groupByField, ['user', 'relation', 'select'], 'groupByField')
    }
    for (const [fieldIndex, field] of module.fields.entries()) {
      const at = `${base}.fields[${fieldIndex}]`
      const rules = rulesOf(field)
      if (field.dataType === 'user' && Array.isArray(rules.roles)) for (const roleName of rules.roles) {
        if (!knownRoles.has(String(roleName)) && !(normalized.roles ?? []).some(role => role.name === roleName)) add(`${at}.validationRules.roles`, `El rol ${roleName} no existe ni se propone en el plano`)
      }
      if (field.dataType === 'relation') {
        if (typeof rules.relationEntity !== 'string' || !target(rules.relationEntity)) add(`${at}.validationRules.relationEntity`, 'La relación debe apuntar a un módulo existente o del plano')
        else rules.relationEntity = target(rules.relationEntity)!
      }
      if (field.dataType === 'tabla' && Array.isArray(rules.columns)) for (const [columnIndex, column] of rules.columns.entries()) {
        if (column.type === 'relation' && (!column.relationEntity || !target(column.relationEntity))) add(`${at}.validationRules.columns[${columnIndex}].relationEntity`, 'La columna referencia un módulo inexistente')
        else if (column.relationEntity) column.relationEntity = target(column.relationEntity)!
      }
      if (field.dataType === 'incremental' && rules.prefixSource) {
        const source = rules.prefixSource as { relationField: string; sourceField: string }
        const relation = fieldFor(module.slug, source.relationField)
        const related = (relation?.validationRules as { relationEntity?: string } | undefined)?.relationEntity
        if (relation?.dataType !== 'relation' || !related || fieldFor(related, source.sourceField)?.dataType !== 'text') add(`${at}.validationRules.prefixSource`, 'El prefijo debe usar una relación propia y un campo de texto del destino')
        if (rules.prefix) add(`${at}.validationRules.prefixSource`, 'No se puede combinar con un prefijo fijo')
      }
      const calc = rules.calculation as Record<string, unknown> | undefined
      if (!calc) continue
      if (calc.kind === 'formula') for (const operand of ['leftField', 'rightField']) {
        const source = fieldFor(module.slug, String(calc[operand]))
        if (!source || !['number', 'currency'].includes(source.dataType) || source.name === field.name) add(`${at}.validationRules.calculation.${operand}`, 'La fórmula usa un campo numérico inexistente o se refiere a sí misma')
      }
      if (calc.kind === 'expression') {
        try {
          for (const ref of collectFieldRefs(parseExpression(String(calc.expression)))) {
            const source = fieldFor(module.slug, ref)
            if (!source || ['tabla', 'file', 'json', 'multiselect'].includes(source.dataType) || ref === field.name) add(`${at}.validationRules.calculation.expression`, `El campo "${ref}" no se puede usar en esta expresión`)
          }
        } catch { add(`${at}.validationRules.calculation.expression`, 'La expresión usa una función, operador o sintaxis que Flow no admite') }
      }
      if (calc.kind === 'rollup') {
        const childSlug = typeof calc.sourceEntity === 'string' ? target(calc.sourceEntity) : null
        if (!childSlug) add(`${at}.validationRules.calculation.sourceEntity`, 'El módulo fuente no existe')
        else {
          calc.sourceEntity = childSlug
          const relation = fieldFor(childSlug, String(calc.relationField))
          if (relation?.dataType !== 'relation' || (relation.validationRules as { relationEntity?: string } | undefined)?.relationEntity !== module.slug) add(`${at}.validationRules.calculation.relationField`, 'El hijo debe tener una relación hacia este módulo')
          if (calc.aggregate !== 'count' && !['number', 'currency'].includes(fieldFor(childSlug, String(calc.valueField))?.dataType ?? '')) add(`${at}.validationRules.calculation.valueField`, 'El campo acumulado debe ser numérico')
          if (calc.filter) {
            const filterField = fieldFor(childSlug, String((calc.filter as { field: string }).field))
            if (!filterField || ['tabla', 'file', 'json', 'multiselect'].includes(filterField.dataType)) add(`${at}.validationRules.calculation.filter.field`, 'El filtro usa un campo inexistente o incompatible')
          }
        }
      }
    }
    const calculatedDependencies = (name: string): string[] => {
      const calculation = (fieldFor(module.slug, name)?.validationRules as { calculation?: Record<string, unknown> } | undefined)?.calculation
      if (calculation?.kind === 'formula') return [String(calculation.leftField), String(calculation.rightField)]
      if (calculation?.kind === 'expression') {
        try { return [...collectFieldRefs(parseExpression(String(calculation.expression)))] } catch { return [] }
      }
      return []
    }
    for (const [fieldIndex, field] of module.fields.entries()) {
      if (!rulesOf(field).calculation) continue
      const visiting = new Set<string>()
      const visited = new Set<string>()
      const visit = (name: string): boolean => {
        if (visiting.has(name)) return true
        if (visited.has(name)) return false
        visiting.add(name)
        for (const dependency of calculatedDependencies(name)) if (visit(dependency)) return true
        visiting.delete(name)
        visited.add(name)
        return false
      }
      if (visit(field.name)) add(`${base}.fields[${fieldIndex}].validationRules.calculation`, 'El cálculo crea una dependencia circular', 'cycle')
    }
    for (const [lineIndex, line] of (module.lines ?? []).entries()) {
      const at = `${base}.lines[${lineIndex}]`
      const childSlug = target(line.childRef)
      if (!childSlug) { add(`${at}.childRef`, 'El módulo de partidas no existe'); continue }
      line.childRef = childSlug
      const relation = fieldFor(childSlug, line.relationField)
      if (relation?.dataType !== 'relation' || (relation.validationRules as { relationEntity?: string } | undefined)?.relationEntity !== module.slug) add(`${at}.relationField`, 'La partida debe tener una relación hacia el encabezado')
      for (const [totalIndex, total] of (line.totals ?? []).entries()) if (!['number', 'currency'].includes(fieldFor(childSlug, total)?.dataType ?? '')) add(`${at}.totals[${totalIndex}]`, 'El total debe usar un campo numérico de la partida')
    }
    const workflow = module.workflow
    if (workflow?.enabled) {
      for (const [transitionIndex, transition] of workflow.transitions.entries()) if (transition.roles !== 'all') for (const roleId of transition.roles) if (!knownRoles.has(roleId)) add(`${base}.workflow.transitions[${transitionIndex}].roles`, 'La transición referencia un rol inexistente')
      const status = fieldFor(module.slug, workflow.field)
      const options = (status?.validationRules as { options?: Array<{ value: string }> } | undefined)?.options ?? []
      if (status?.dataType !== 'select' || Object.keys(workflow.states).some(state => !options.some(option => option.value === state))) add(`${base}.workflow.field`, 'El flujo debe usar un Select con todos sus estados')
      for (const [state, definition] of Object.entries(workflow.states)) for (const name of definition.editableFields) if (!fieldFor(module.slug, name)) add(`${base}.workflow.states.${state}.editableFields`, `El campo "${name}" no existe`)
      for (const [ruleIndex, rule] of (workflow.rules ?? []).entries()) {
        const at = `${base}.workflow.rules[${ruleIndex}]`
        if (rule.type === 'required') {
          for (const name of rule.fields) if (!fieldFor(module.slug, name)) add(`${at}.fields`, `El campo "${name}" no existe`)
        } else {
          const childSlug = target(rule.lineEntity)
          if (!childSlug || !module.lines?.some(line => line.childRef === childSlug && line.relationField === rule.relationField)) add(`${at}.lineEntity`, 'La regla debe usar una partida del detalle')
          else rule.lineEntity = childSlug
          if (rule.type === 'aggregate' && rule.aggregate === 'sum' && fieldFor(childSlug ?? '', rule.field ?? '')?.dataType !== 'number') add(`${at}.field`, 'La suma requiere un campo numérico de partida')
          if (rule.type === 'lineCompare') {
            if (fieldFor(childSlug ?? '', rule.valueField)?.dataType !== 'number') add(`${at}.valueField`, 'La cantidad debe ser numérica')
            const related = fieldFor(childSlug ?? '', rule.relatedField)
            const relatedSlug = (related?.validationRules as { relationEntity?: string } | undefined)?.relationEntity
            if (related?.dataType !== 'relation' || fieldFor(relatedSlug ?? '', rule.compareField)?.dataType !== 'number') add(`${at}.relatedField`, 'La comparación requiere una relación con un campo numérico')
          }
        }
      }
    }
    const existing = bySlug.get(module.slug)
    if (module.action === 'extend' && existing?.detailLayout && module.lines?.length) {
      const layout = existing.detailLayout as { relations?: Array<{ entitySlug: string; fieldName: string; editable?: boolean }> }
      // Las líneas existentes de una instantánea son solo lectura; las propuestas nuevas se suman al diseño.
      if (!module.snapshot && !Array.isArray(layout.relations)) add(`${base}.lines`, 'El diseño de detalle existente es inválido')
    }
  }
  for (const [index, association] of normalized.associations.entries()) {
    for (const part of ['sourceRef', 'targetRef'] as const) {
      const resolved = target(association[part])
      if (!resolved) add(`associations[${index}].${part}`, 'La asociación apunta a un módulo inexistente')
      else association[part] = resolved
    }
    if (association.sourceRef === association.targetRef) add(`associations[${index}].targetRef`, 'Una asociación no puede conectar un módulo consigo mismo; usa un campo relación de jerarquía si corresponde')
    if (normalized.associations.findIndex(item => item.name === association.name) !== index) add(`associations[${index}].name`, 'El nombre de la asociación está repetido')
    const existing = current.associations.find(item => item.name === association.name)
    if (existing && (bySlug.get(association.sourceRef)?.id !== existing.sourceEntityId || bySlug.get(association.targetRef)?.id !== existing.targetEntityId)) add(`associations[${index}].name`, 'La asociación existente usa otros módulos y no se puede cambiar')
  }
  for (const [index, role] of (normalized.roles ?? []).entries()) {
    if (normalized.roles?.findIndex(item => item.name.toLowerCase() === role.name.toLowerCase()) !== index) add(`roles[${index}].name`, 'El rol está repetido')
    for (const [permissionIndex, permission] of role.permissions.entries()) {
      const resolved = target(permission.moduleRef)
      if (!resolved) add(`roles[${index}].permissions[${permissionIndex}].moduleRef`, 'El módulo no existe')
      else permission.moduleRef = resolved
      if (role.permissions.findIndex(item => item.moduleRef === permission.moduleRef) !== permissionIndex) add(`roles[${index}].permissions[${permissionIndex}]`, 'El módulo está repetido para este rol')
    }
  }
  return { normalized, errors, merges, current, newFields: new Map(normalized.modules.map(module => [module.ref, module.fields.filter(field => !((current.fieldsById.get(bySlug.get(module.slug)?.id ?? '') ?? []).some(existing => existing.name === field.name)))])) }
}

export async function validateBlueprintInTx(tx: BlueprintTx, tenantId: string, input: unknown): Promise<BlueprintValidationResult> {
  const shape = blueprintSchema.safeParse(input)
  if (!shape.success) return invalidBlueprintShape(shape.error.issues, input)
  const current = await loadBlueprintTenant(tx, tenantId)
  const knownRoles = new Set((await tx.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.tenantId, tenantId))).flatMap(role => [role.id, role.name]))
  return validateBlueprintAgainstCurrent(shape.data, current, knownRoles)
}

/** Evaluación sin base de datos: materializa la misma forma que exportBlueprint carga del tenant. */
export async function validateBlueprintAgainstSnapshot(input: unknown, snapshot: Blueprint): Promise<BlueprintValidationResult> {
  const shape = blueprintSchema.safeParse(input)
  if (!shape.success) return invalidBlueprintShape(shape.error.issues, input)
  const fieldsById = new Map(snapshot.modules.map(module => [module.slug, module.fields.map(field => ({
    name: field.name, label: field.label, dataType: field.dataType, isRequired: Boolean(field.required), isOwnerField: Boolean(field.isOwnerField), validationRules: field.validationRules ?? {}
  }))]))
  const modules = snapshot.modules.map(module => ({
    id: module.slug, slug: module.slug, moduleKind: module.kind, name: module.name,
    singularName: module.singularName ?? null, description: module.description ?? null, icon: module.icon ?? null,
    detailLayout: module.detailLayout ?? null, workflowConfig: module.workflow ?? null, calendarConfig: module.calendarConfig ?? null
  }))
  const associations = snapshot.associations.map(association => ({
    name: association.name, sourceEntityId: association.sourceRef, targetEntityId: association.targetRef
  }))
  const current = { modules, fieldsById, associations } as unknown as Awaited<ReturnType<typeof loadBlueprintTenant>>
  return validateBlueprintAgainstCurrent(shape.data, current, new Set((snapshot.roles ?? []).map(role => role.name)))
}

export async function validateBlueprint(tenantId: string, input: unknown): Promise<BlueprintValidationResult> {
  const result = await withTenant(tenantId, tx => validateBlueprintInTx(tx, tenantId, input))
  if (result.normalized) {
    const incoming = result.normalized.modules.filter(module => module.action === 'create' && module.kind === 'hecho').length
    if (incoming) {
      const plan = await blueprintPlanImpact(tenantId, incoming)
      if (!plan.allowed) result.errors.push({ path: 'modules', message: `Se alcanzó el límite de módulos del plan ${plan.name}`, code: 'plan_limit' })
    }
  }
  return result
}
