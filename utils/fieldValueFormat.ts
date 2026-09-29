import { formatCurrencyValue } from '~/utils/currency'

const DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC' })
const INSTANT_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City' })

/** Formato estable para fechas puras y fechas de instantes, sin depender de la zona del runtime. */
export function formatDate(value: string | number | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : DATE_FORMATTER.format(date)
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : INSTANT_DATE_FORMATTER.format(date)
}

export interface FormattableField {
  name: string
  dataType: string
  validationRules?: Record<string, unknown> | null
}

/** Tamaño legible para adjuntos, compartido por las vistas de solo lectura. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Texto legible de un valor de custom_data según el tipo del campo (tablas de líneas y asociaciones). */
export function formatFieldValue(field: FormattableField, value: unknown, relationLabels?: Record<string, Record<string, string>>): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (field.dataType) {
    case 'boolean': return value ? 'Sí' : 'No'
    case 'date':
    case 'datetime': {
      return formatDate(value as string)
    }
    case 'currency': return formatCurrencyValue(value, field.validationRules ?? undefined)
    case 'select':
    case 'multiselect': {
      const options = Array.isArray(field.validationRules?.options) ? (field.validationRules.options as Array<{ value: string; label: string }>) : []
      const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v
      return Array.isArray(value) ? value.map(labelFor).join(', ') || '-' : labelFor(String(value))
    }
    case 'relation': return relationLabels?.[field.name]?.[String(value)] ?? String(value).slice(0, 8)
    case 'user': return (Array.isArray(value) ? value : [value]).map(id => relationLabels?.[field.name]?.[String(id)] ?? `${String(id).slice(0, 8)} (inactivo)`).join(', ')
    // El ID es un identificador interno; las vistas deben usar DynamicFileValue
    // para resolver metadata autorizada y renderizar una vista previa/enlace.
    case 'file': return 'Archivo'
    case 'json': return typeof value === 'string' ? value : JSON.stringify(value)
    default: return String(value)
  }
}
