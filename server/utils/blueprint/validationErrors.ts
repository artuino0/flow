import type { BlueprintValidationError } from './validate'

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const label = (value: unknown, fallback: string) => typeof value === 'string' ? value.replace(/[<>\r\n]/g, '').slice(0, 100) || fallback : fallback
const ruleLabels: Record<string, string> = { calculation: 'cálculo', options: 'opciones', relationEntity: 'relación de destino', unique: 'valor único', columns: 'columnas', digits: 'dígitos del consecutivo', prefixSource: 'origen del prefijo' }
const typeLabels: Record<string, string> = { text: 'texto', number: 'número', currency: 'moneda', boolean: 'booleano', date: 'fecha', relation: 'relación', user: 'Usuario', select: 'selección', multiselect: 'selección múltiple', file: 'archivo', incremental: 'consecutivo' }

/** Localiza sin incluir valores de registros ni mensajes del proveedor. */
export function locateBlueprintError(input: unknown, error: BlueprintValidationError): BlueprintValidationError {
  const match = /^modules\[(\d+)\](?:\.fields\[(\d+)\])?/.exec(error.path)
  if (!match || !record(input) || !Array.isArray(input.modules)) return error
  const module = input.modules[Number(match[1])]
  if (!record(module)) return error
  const moduleName = label(module.name, `módulo ${Number(match[1]) + 1}`)
  const field = match[2] !== undefined && Array.isArray(module.fields) ? module.fields[Number(match[2])] : null
  const ruleKey = /\.validationRules\.([^.[\]]+)/.exec(error.path)?.[1] ?? error.ruleKey
  if (!record(field)) return { ...error, moduleName, message: `En ${moduleName}: ${error.message}` }
  const fieldName = label(field.label ?? field.name, `campo ${Number(match[2]) + 1}`)
  const dataType = label(field.dataType, 'tipo desconocido')
  return { ...error, moduleName, fieldName, dataType, ...(ruleKey ? { ruleKey } : {}), message: `En ${moduleName}, el campo «${fieldName}» (${typeLabels[dataType] ?? dataType})${ruleKey ? `, regla ${ruleLabels[ruleKey] ?? ruleKey}` : ''}: ${error.message}` }
}
