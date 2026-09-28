import { stateWorkflowSchema } from '~/server/utils/stateWorkflow'

type Entry = Record<string, unknown>
const record = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Convierte únicamente variantes inequívocas del flujo emitido por la IA. Las pérdidas se devuelven para el chat. */
export function normalizeDesignerWorkflows(input: unknown): { blueprint: unknown; warnings: string[] } {
  if (!record(input) || !Array.isArray(input.modules)) return { blueprint: input, warnings: [] }
  const warnings: string[] = []
  const modules = input.modules.map((module: unknown, moduleIndex: number) => {
    if (!record(module) || !record(module.workflow)) return module
    const workflow = { ...module.workflow }
    const moduleName = nonempty(module.name) ? module.name : `módulo ${moduleIndex + 1}`
    const warn = (part: string, reason: string) => warnings.push(`En ${moduleName}, no pude configurar ${part}: ${reason}; agrégalo desde el inspector.`)

    if (Array.isArray(workflow.states)) {
      const states: Entry = Object.create(null) as Entry
      for (const [index, item] of workflow.states.entries()) {
        const value = typeof item === 'string' ? item : record(item) ? (item.value ?? item.name ?? item.label) : undefined
        if (!nonempty(value) || Object.hasOwn(states, value)) {
          warn(`el estado ${index + 1}`, 'su valor es ambiguo, vacío o repetido')
          continue
        }
        const locked = record(item) ? item.locked : undefined
        const editableFields = record(item) ? item.editableFields : undefined
        if ((locked !== undefined && typeof locked !== 'boolean') || (editableFields !== undefined && (!Array.isArray(editableFields) || !editableFields.every(nonempty)))) {
          warn(`el estado ${value}`, 'locked o editableFields tiene un formato inválido')
          continue
        }
        states[value] = { locked: locked ?? false, editableFields: editableFields ?? [] }
      }
      workflow.states = states
    }
    if (!record(workflow.states) || !Object.keys(workflow.states).length) {
      warn('el flujo de estados', 'no hay estados válidos')
      return { ...module, workflow: undefined }
    }
    if (workflow.enabled === undefined) workflow.enabled = true
    if (workflow.initial === undefined) workflow.initial = Object.keys(workflow.states)[0]
    if (workflow.transitions === undefined) workflow.transitions = []
    if (Array.isArray(workflow.transitions)) {
      const seen = new Set<string>()
      workflow.transitions = workflow.transitions.flatMap((item, index) => {
        if (!record(item) || !nonempty(item.from) || !nonempty(item.to) || !Object.hasOwn(workflow.states as Entry, item.from) || !Object.hasOwn(workflow.states as Entry, item.to)) {
          warn(`la transición ${index + 1}`, 'referencia un estado inexistente o no tiene origen y destino válidos')
          return []
        }
        const pair = `${item.from}\u0000${item.to}`
        if (seen.has(pair)) { warn(`la transición ${index + 1}`, 'está repetida'); return [] }
        seen.add(pair)
        return [{ ...item, roles: item.roles === undefined ? 'all' : item.roles }]
      })
    } else { warn('las transiciones', 'su formato es inválido'); workflow.transitions = [] }
    if (Array.isArray(workflow.rules)) {
      workflow.rules = workflow.rules.flatMap((item, index) => {
        if (!record(item)) { warn(`la regla ${index + 1}`, 'su formato es inválido'); return [] }
        const when = nonempty(item.when) ? { to: item.when } : item.when
        const rule = { ...item, when }
        const parsed = stateWorkflowSchema.safeParse({ enabled: true, field: 'estado', initial: Object.keys(workflow.states as Entry)[0], states: workflow.states, transitions: [], rules: [rule] })
        if (!parsed.success) { warn(`la regla ${nonempty(item.id) ? item.id : index + 1}`, 'faltan datos o usa estados o campos con formato inválido'); return [] }
        return [rule]
      })
    } else if (workflow.rules !== undefined) { warn('las reglas', 'su formato es inválido'); workflow.rules = [] }
    return { ...module, workflow }
  })
  return { blueprint: { ...input, modules }, warnings }
}
