import { formatCurrencyValue } from '~/utils/currency'

export interface FormattableField {
  name: string
  dataType: string
  validationRules?: Record<string, unknown> | null
}

/** Texto legible de un valor de custom_data según el tipo del campo (tablas de líneas y asociaciones). */
export function formatFieldValue(field: FormattableField, value: unknown, relationLabels?: Record<string, Record<string, string>>): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (field.dataType) {
    case 'boolean': return value ? 'Sí' : 'No'
    case 'date':
    case 'datetime': {
      const date = new Date(value as string)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
    }
    case 'currency': return formatCurrencyValue(value, field.validationRules ?? undefined)
    case 'select':
    case 'multiselect': {
      const options = Array.isArray(field.validationRules?.options) ? (field.validationRules.options as Array<{ value: string; label: string }>) : []
      const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v
      return Array.isArray(value) ? value.map(labelFor).join(', ') || '-' : labelFor(String(value))
    }
    case 'relation': return relationLabels?.[field.name]?.[String(value)] ?? String(value).slice(0, 8)
    case 'json': return typeof value === 'string' ? value : JSON.stringify(value)
    default: return String(value)
  }
}
