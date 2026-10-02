export interface ValidationParameter {
  type: string
  default?: unknown
  example?: unknown
  optional?: boolean
  required?: boolean
  value?: unknown
  values?: string[]
  limits?: Array<{ kind: string; value?: number; inclusive?: boolean }>
  properties?: Record<string, ValidationParameter>
  items?: ValidationParameter
  options?: ValidationParameter[]
  min?: number
  max?: number
}
export interface CatalogValidation {
  id: string; label: string; description: string; types: string[]
  parameters: Record<string, ValidationParameter>
}
export interface FieldValidationCatalog {
  validations: CatalogValidation[]
  formats: Array<{ id: string; label: string; description: string; example: string }>
  file: { types: Array<{ id: string; label: string }> }
}
// Catálogo público autenticado, sin datos de organización. Solo carga al abrir.
let cached: { catalog: FieldValidationCatalog; expires: number } | undefined
let loading: Promise<FieldValidationCatalog> | undefined
export async function loadFieldValidationCatalog(fetcher: () => Promise<FieldValidationCatalog>): Promise<FieldValidationCatalog> {
  if (cached && cached.expires > Date.now()) return cached.catalog
  if (loading) return loading
  loading = fetcher().then(catalog => { cached = { catalog, expires: Date.now() + 300000 }; return catalog }).finally(() => { loading = undefined })
  return loading
}
export const STRUCTURAL_RULES = new Set(['calculation', 'options', 'columns', 'relationEntity', 'digits', 'prefix', 'prefixSource', 'multiple', 'unique', 'roles', 'defaultCurrentUser'])

export function parameterError(parameter: ValidationParameter, value: unknown): string {
  if (value === undefined && parameter.optional) return ''
  if (parameter.type === 'union') return parameter.options?.some(p => !parameterError(p, value)) ? '' : 'Elige un valor válido'
  if (parameter.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Introduce un número'
    for (const limit of parameter.limits ?? []) {
      if (limit.kind === 'int' && !Number.isInteger(value)) return 'Debe ser entero'
      if (limit.kind === 'min' && (limit.inclusive === false ? value <= limit.value! : value < limit.value!)) return `Mínimo${limit.inclusive === false ? ' exclusivo' : ''}: ${limit.value}`
      if (limit.kind === 'max' && value > limit.value!) return `Máximo: ${limit.value}`
    }
  } else if (parameter.type === 'string') {
    if (typeof value !== 'string') return 'Introduce texto'
    for (const limit of parameter.limits ?? []) {
      if (limit.kind === 'min' && value.length < limit.value!) return `Mínimo: ${limit.value} caracteres`
      if (limit.kind === 'max' && value.length > limit.value!) return `Máximo: ${limit.value} caracteres`
    }
  } else if (parameter.type === 'boolean' && typeof value !== 'boolean') return 'Elige sí o no'
  else if (parameter.type === 'enum' && !parameter.values?.includes(String(value))) return 'Elige una opción del catálogo'
  else if (parameter.type === 'literal' && value !== parameter.value) return 'Elige el valor indicado'
  else if (parameter.type === 'array') {
    if (!Array.isArray(value)) return 'Elige los valores'
    if (parameter.min !== undefined && value.length < parameter.min) return `Elige al menos ${parameter.min}`
    if (parameter.max !== undefined && value.length > parameter.max) return `Máximo: ${parameter.max}`
    for (const item of value) { const error = parameterError(parameter.items!, item); if (error) return error }
  } else if (parameter.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Completa los parámetros'
    for (const [key, child] of Object.entries(parameter.properties ?? {})) {
      const error = parameterError(child, (value as Record<string, unknown>)[key]); if (error) return error
    }
  }
  return ''
}
