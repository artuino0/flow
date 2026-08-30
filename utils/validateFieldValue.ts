import type { EntityFieldMeta } from '~/composables/useEntityFields'

// HU-ERD-23: validacion en cliente "espejo" de server/utils/dynamicSchema.ts
// (HU-ERD-17). Mismas reglas (min/maxLength, pattern, min/max numerico,
// integer, enum, min/max de fecha, forma de uuid para relation), para dar
// feedback inmediato en el formulario - el servidor sigue siendo la unica
// fuente de verdad (esto nunca reemplaza la revalidacion del backend).
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

  if (isEmpty(rawValue)) {
    return field.isRequired
      ? { valid: false, error: `"${field.label}" es requerido` }
      : { valid: true }
  }

  switch (field.dataType) {
    case 'text': {
      if (Array.isArray(rules.enum) && rules.enum.length > 0) {
        if (!rules.enum.includes(rawValue)) {
          return { valid: false, error: `"${field.label}" debe ser uno de: ${rules.enum.join(', ')}` }
        }
        return { valid: true }
      }
      const s = String(rawValue)
      if (typeof rules.minLength === 'number' && s.length < rules.minLength) {
        return { valid: false, error: `"${field.label}" debe tener al menos ${rules.minLength} caracteres` }
      }
      if (typeof rules.maxLength === 'number' && s.length > rules.maxLength) {
        return { valid: false, error: `"${field.label}" debe tener como maximo ${rules.maxLength} caracteres` }
      }
      if (typeof rules.pattern === 'string' && !new RegExp(rules.pattern).test(s)) {
        return { valid: false, error: `"${field.label}" no tiene el formato esperado` }
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
    default:
      return { valid: true }
  }
}
