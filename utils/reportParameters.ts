import { z } from 'zod'

export const parameterSourceSchema = z.object({ side: z.enum(['base', 'detail']), forwardHops: z.array(z.string().min(1)).max(3), field: z.string().min(1) }).strict()
export const reportParameterSchema = z.object({
  id: z.string().min(1).max(80), source: parameterSourceSchema,
  label: z.string().trim().min(1).max(80),
  input: z.enum(['text', 'select', 'date', 'dateRange', 'number', 'numberRange', 'checkbox', 'toggle']),
  required: z.boolean().default(false)
}).strict()
export type ReportParameter = z.infer<typeof reportParameterSchema>
export interface ParameterAnswer { value?: string; end?: string; operator?: 'eq' | 'contains' | 'lt' | 'gt' | 'between'; recordId?: boolean }
export type ParameterAnswers = Record<string, ParameterAnswer>
export const answerSchema = z.record(z.object({ value: z.string().max(500).optional(), end: z.string().max(500).optional(), operator: z.enum(['eq', 'contains', 'lt', 'gt', 'between']).optional(), recordId: z.boolean().optional() }).strict())
export const parameterInputs = [
  { value: 'text', label: 'Texto' }, { value: 'select', label: 'Selector con buscador' },
  { value: 'date', label: 'Fecha' }, { value: 'dateRange', label: 'Rango de fechas' },
  { value: 'number', label: 'Número' }, { value: 'numberRange', label: 'Rango numérico' },
  { value: 'checkbox', label: 'Casilla (Sí / No)' }, { value: 'toggle', label: 'Interruptor (Sí / No)' }
] as const
export function inputsForType(type: string) {
  const allowed = type === 'boolean' ? ['checkbox', 'toggle'] : type === 'date' ? ['date', 'dateRange'] : ['number', 'currency', 'incremental'].includes(type) ? ['number', 'numberRange'] : type === 'text' ? ['text', 'select'] : type === 'select' ? ['select'] : []
  return parameterInputs.filter(input => allowed.includes(input.value))
}
type ResolvedFilter = { source: ReportParameter['source']; value: string; operator: 'eq' | 'contains' | 'gte' | 'lte' | 'lt' | 'gt'; recordId: boolean }
export function resolveParameterFilters(parameters: ReportParameter[], answers: ParameterAnswers): ResolvedFilter[] {
  return parameters.flatMap<ResolvedFilter>(parameter => {
    const answer = answers[parameter.id]
    const value = answer?.value?.trim()
    if (!value) {
      if (parameter.required) throw new Error(`Completa ${parameter.label}.`)
      return []
    }
    const boolean = ['checkbox', 'toggle'].includes(parameter.input)
    if (boolean && !['true', 'false'].includes(value)) throw new Error(`${parameter.label}: selecciona Sí o No.`)
    const range = ['dateRange', 'numberRange'].includes(parameter.input)
    const numeric = ['number', 'numberRange'].includes(parameter.input)
    const date = ['date', 'dateRange'].includes(parameter.input)
    const validate = (v: string) => {
      if (numeric && !Number.isFinite(Number(v))) throw new Error(`${parameter.label}: número inválido.`)
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new Error(`${parameter.label}: fecha inválida.`)
    }
    validate(value)
    const filter = { source: parameter.source, value, recordId: parameter.input === 'select' && !!answer.recordId }
    if (range) {
      const end = answer.end?.trim()
      if (!end) throw new Error(`Completa ambos extremos de ${parameter.label}.`)
      validate(end)
      if (numeric ? Number(value) > Number(end) : value > end) throw new Error(`${parameter.label}: el inicio debe ser anterior o igual al final.`)
      return [{ ...filter, operator: 'gte' as const }, { ...filter, value: end, operator: 'lte' as const }]
    }
    const operator = parameter.input === 'text' ? (answer.operator === 'eq' ? 'eq' : 'contains') : date || numeric ? (answer.operator === 'lt' || answer.operator === 'gt' ? answer.operator : 'eq') : 'eq'
    return [{ ...filter, operator }]
  })
}
