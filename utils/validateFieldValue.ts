import type { EntityFieldMeta } from '~/composables/useEntityFields'

// Feedback local acotado; las reglas de formato y referencias las valida el servidor.
export function normalizeClientText(value: string, rules: Record<string, unknown>): string {
  let normalized = rules.trim === true ? value.trim() : value
  if (rules.case === 'upper') normalized = normalized.toUpperCase()
  if (rules.case === 'lower') normalized = normalized.toLowerCase()
  return normalized
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface FieldValidationResult {
  valid: boolean
  error?: string
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

export function validateFieldValue(field: EntityFieldMeta, rawValue: unknown): FieldValidationResult {
  const rules = field.validationRules ?? {}

  if (field.dataType === 'text' && rawValue === '' && rules.notBlank === true) return { valid: false, error: 'Texto no vacío: Rechaza texto vacío o formado únicamente por espacios.' }
  if (isEmpty(rawValue)) {
    return field.isRequired
      ? { valid: false, error: `"${field.label}" es requerido` }
      : { valid: true }
  }

  switch (field.dataType) {
    case 'text': {
      const s = normalizeClientText(String(rawValue), rules)
      if (rules.notBlank === true && !s.trim()) return { valid: false, error: 'Texto no vacío: Rechaza texto vacío o formado únicamente por espacios.' }
      if (typeof rules.minLength === 'number' && s.length < rules.minLength) {
        return { valid: false, error: 'Longitud mínima: Cantidad mínima de caracteres.' }
      }
      if (typeof rules.maxLength === 'number' && s.length > rules.maxLength) {
        return { valid: false, error: 'Longitud máxima: Cantidad máxima de caracteres.' }
      }
      return { valid: true }
    }
    case 'number': {
      const n = typeof rawValue === 'number' ? rawValue : Number(rawValue)
      if (Number.isNaN(n)) {
        return { valid: false, error: `"${field.label}" debe ser un numero` }
      }
      if (rules.integer === true && !Number.isInteger(n)) {
        return { valid: false, error: `"${field.label}" debe ser un numero entero` }
      }
      if (typeof rules.min === 'number' && n < rules.min) {
        return { valid: false, error: `"${field.label}" debe ser mayor o igual a ${rules.min}` }
      }
      if (typeof rules.max === 'number' && n > rules.max) {
        return { valid: false, error: `"${field.label}" debe ser menor o igual a ${rules.max}` }
      }
      return { valid: true }
    }
    case 'currency': {
      const text = String(rawValue).trim()
      const decimals = typeof rules.decimals === 'number' ? rules.decimals : 2
      const pattern = decimals === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+(?:\\.\\d{1,${decimals}})?$`)
      if (!pattern.test(text)) return { valid: false, error: `"${field.label}" debe ser un monto con máximo ${decimals} decimales` }
      const amount = Number(text)
      if (rules.allowNegative !== true && amount < 0) return { valid: false, error: `"${field.label}" no puede ser negativo` }
      if (typeof rules.min === 'number' && amount < rules.min) return { valid: false, error: `"${field.label}" debe ser mayor o igual a ${rules.min}` }
      if (typeof rules.max === 'number' && amount > rules.max) return { valid: false, error: `"${field.label}" debe ser menor o igual a ${rules.max}` }
      return { valid: true }
    }
    case 'boolean':
      return typeof rawValue === 'boolean' ? { valid: true } : { valid: false, error: `"${field.label}" invalido` }
    case 'date': {
      const d = new Date(rawValue as string)
      if (Number.isNaN(d.getTime())) {
        return { valid: false, error: `"${field.label}" debe ser una fecha valida` }
      }
      if (typeof rules.min === 'string' && d < new Date(rules.min)) {
        return { valid: false, error: `"${field.label}" debe ser posterior a ${rules.min}` }
      }
      if (typeof rules.max === 'string' && d > new Date(rules.max)) {
        return { valid: false, error: `"${field.label}" debe ser anterior a ${rules.max}` }
      }
      return { valid: true }
    }
    case 'json': {
      if (typeof rawValue !== 'string') return { valid: true }
      try {
        JSON.parse(rawValue)
        return { valid: true }
      } catch {
        return { valid: false, error: `"${field.label}" debe ser JSON valido` }
      }
    }
    case 'relation': {
      const s = String(rawValue)
      if (!UUID_RE.test(s)) {
        return { valid: false, error: `"${field.label}" debe ser un id valido (uuid)` }
      }
      return { valid: true }
    }
    // HU-ERD-73: espejo de buildFieldType() (server/utils/dynamicSchema.ts,
    // casos 'select'/'multiselect') - un value que no esta en
    // validationRules.options nunca pasaria el z.enum() real del servidor.
    case 'select': {
      const options = Array.isArray(rules.options) ? (rules.options as Array<{ value: string }>) : []
      const values = options.map((o) => o.value)
      if (values.length > 0 && !values.includes(String(rawValue))) {
        return { valid: false, error: `"${field.label}" debe ser una de las opciones configuradas` }
      }
      return { valid: true }
    }
    // Igual que 'tabla': un array vacio no cae en isEmpty() (solo
    // null/undefined/'' cuentan como vacio ahi) - "requerido" para multiselect
    // se resuelve aca.
    case 'multiselect': {
      const chosen = Array.isArray(rawValue) ? (rawValue as unknown[]) : []
      if (chosen.length === 0) {
        return field.isRequired ? { valid: false, error: `"${field.label}" es requerido` } : { valid: true }
      }
      const options = Array.isArray(rules.options) ? (rules.options as Array<{ value: string }>) : []
      const values = options.map((o) => o.value)
      if (values.length > 0 && chosen.some((v) => !values.includes(String(v)))) {
        return { valid: false, error: `"${field.label}" tiene un valor que no esta entre las opciones configuradas` }
      }
      return { valid: true }
    }
    // HU-ERD-72: un array vacio no cae en isEmpty() de arriba (solo
    // null/undefined/'' cuentan como vacio ahi) - "requerido" para un campo
    // Tabla se resuelve aca, no antes del switch. Solo valida que las
    // columnas de relacion tengan forma de uuid (mismo criterio que el caso
    // 'relation' de arriba) - la copia/calculo en vivo de DynamicTableField.vue
    // ya garantiza la forma del resto de columnas al escribirlas.
    case 'tabla': {
      const rows = Array.isArray(rawValue) ? (rawValue as Array<Record<string, unknown>>) : []
      if (rows.length === 0) {
        return field.isRequired ? { valid: false, error: `"${field.label}" necesita al menos una fila` } : { valid: true }
      }
      const columns = Array.isArray(rules.columns) ? (rules.columns as Array<{ name: string; type: string }>) : []
      for (const row of rows) {
        for (const col of columns) {
          if (col.type !== 'relation') continue
          const v = row[col.name]
          if (v && !UUID_RE.test(String(v))) {
            return { valid: false, error: `"${field.label}": falta elegir un valor para "${col.name}" en una fila` }
          }
        }
      }
      return { valid: true }
    }
    default:
      return { valid: true }
  }
}
