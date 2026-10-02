import { z } from 'zod'
import type { EntityFieldRow } from '~/server/utils/dynamicSchema'
import { calculationSchema, tableColumnSchema, selectOptionSchema } from './configSchemas'
import { TEXT_FORMATS, validateTextFormat } from './formats'
import { FIELD_FILE_TYPES, FIELD_FILE_TYPE_IDS, MAX_FILE_SIZE_BYTES, matchesAllowedFieldFileType } from './filePolicy'

export const DATA_TYPES = ['text', 'number', 'currency', 'boolean', 'date', 'json', 'relation', 'user', 'tabla', 'select', 'multiselect', 'file', 'incremental'] as const
export interface ValidationContext { timezone?: string; now?: Date; record?: Record<string, unknown>; file?: { mimeType: string; fileName: string; sizeBytes: number } | null; target?: Record<string, unknown> | null }
type Rules = Record<string, unknown>
interface Variant { schema: z.ZodTypeAny; example: unknown; value: unknown }
interface Capability {
  id: string
  label: string
  description: string
  variants: Partial<Record<typeof DATA_TYPES[number], Variant>>
  reference?: 'file' | 'relation'
  normalize?: (value: string, parameter: unknown) => string
  check: (value: unknown, parameter: unknown, context: ValidationContext, rules: Rules) => boolean
}
const variant = (schema: z.ZodTypeAny, example: unknown, value: unknown): Variant => ({ schema, example, value })
const numeric = z.number().finite()
const count = z.number().int().nonnegative()
const fieldName = z.string().trim().min(1).max(100)
const validDateString = (s: string) => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(`${s.slice(0, 10)}T12:00:00Z`).toISOString().slice(0, 10) === s.slice(0, 10)
const fixedDate = z.string().refine(validDateString, 'Debe ser una fecha ISO válida')
const metadata = () => true
const numberValue = (v: unknown) => Number(v)
const uniqueKeys = (items: Array<Record<string, unknown>>, key: string) => new Set(items.map(item => item[key])).size === items.length
const options = z.array(selectOptionSchema).min(1).refine(items => uniqueKeys(items, 'value'), 'Hay valores (value) duplicados entre las opciones de este campo')
const columns = z.array(tableColumnSchema).min(1).refine(items => uniqueKeys(items, 'name'), 'Hay columnas con el mismo nombre técnico en este campo')

/** Día civil: las fechas sin hora ya representan un día; los instantes usan la zona de la organización. */
export function dateDay(value: unknown, timezone = 'America/Mexico_City'): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`
}
function relativeDay(days: unknown, context: ValidationContext) {
  const today = dateDay(context.now ?? new Date(), context.timezone)
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + Number(days))
  return date.toISOString().slice(0, 10)
}

// Un id por capacidad. Los parámetros que dependen del tipo viven en variantes de esa misma capacidad.
export const FIELD_VALIDATIONS: Capability[] = [
  { id: 'dateFormat', label: 'Formato de fecha', description: 'Fecha siempre visible: corta (01/10/2026), intermedia (1 oct 2026) o larga (1 de octubre de 2026); no modifica el dato guardado.', variants: { date: variant(z.enum(['short', 'medium', 'long']).default('short'), 'medium', '2026-10-01') }, check: metadata },
  { id: 'showRelative', label: 'Mostrar tiempo relativo', description: 'Agrega junto a la fecha cuánto pasó o cuánto falta respecto a hoy, por ejemplo hace 12 días o en 1 mes.', variants: { date: variant(z.boolean().default(false), true, '2026-10-01') }, check: metadata },
  { id: 'minLength', label: 'Longitud mínima', description: 'Cantidad mínima de caracteres.', variants: { text: variant(count, 2, 'Ana') }, check: (v, p) => String(v).length >= Number(p) },
  { id: 'maxLength', label: 'Longitud máxima', description: 'Cantidad máxima de caracteres.', variants: { text: variant(count, 100, 'Ana') }, check: (v, p) => String(v).length <= Number(p) },
  { id: 'format', label: 'Formato guiado', description: 'Plantilla fija revisada; no admite expresiones personalizadas.', variants: { text: variant(z.enum(TEXT_FORMATS.map(f => f.id) as [string, ...string[]]), 'email', 'ana@example.com') }, check: (v, p) => validateTextFormat(String(p), String(v)) },
  { id: 'trim', label: 'Quitar espacios exteriores', description: 'Recorta espacios al inicio y al final antes de validar y guardar.', variants: { text: variant(z.boolean(), true, 'Ana') }, normalize: (v, p) => p === true ? v.trim() : v, check: metadata },
  { id: 'case', label: 'Mayúsculas o minúsculas', description: 'Convierte el texto antes de validar y guardar.', variants: { text: variant(z.enum(['upper', 'lower']), 'upper', 'ANA') }, normalize: (v, p) => p === 'upper' ? v.toUpperCase() : p === 'lower' ? v.toLowerCase() : v, check: metadata },
  { id: 'notBlank', label: 'Texto no vacío', description: 'Rechaza texto vacío o formado únicamente por espacios.', variants: { text: variant(z.boolean(), true, 'Ana') }, check: (v, p) => p !== true || String(v).trim().length > 0 },
  { id: 'default', label: 'Valor predeterminado', description: 'Se aplica solo al crear si no se envió el campo; today usa el día de la organización.', variants: {
    text: variant(z.string(), 'Sin nombre', 'Sin nombre'), number: variant(numeric, 1, 1), currency: variant(z.union([numeric, z.string().regex(/^-?\d+(?:\.\d+)?$/)]), '0.00', '0.00'), date: variant(z.union([z.literal('today'), fixedDate]), 'today', '2026-10-01'), boolean: variant(z.boolean(), false, false), select: variant(z.string(), 'nuevo', 'nuevo'), multiselect: variant(z.array(z.string()), ['nuevo'], ['nuevo'])
  }, check: metadata },
  { id: 'min', label: 'Mínimo', description: 'Valor mínimo o fecha mínima absoluta, inclusive.', variants: { number: variant(numeric, 0, 2), currency: variant(numeric, 0, '2.00'), date: variant(fixedDate, '2026-01-01', '2026-10-01') }, check: (v, p) => v instanceof Date || typeof p === 'string' ? new Date(String(v)) >= new Date(String(p)) : numberValue(v) >= Number(p) },
  { id: 'max', label: 'Máximo', description: 'Valor máximo o fecha máxima absoluta, inclusive.', variants: { number: variant(numeric, 100, 2), currency: variant(numeric, 100, '2.00'), date: variant(fixedDate, '2026-12-31', '2026-10-01') }, check: (v, p) => v instanceof Date || typeof p === 'string' ? new Date(String(v)) <= new Date(String(p)) : numberValue(v) <= Number(p) },
  { id: 'integer', label: 'Número entero', description: 'No permite parte decimal.', variants: { number: variant(z.boolean(), true, 2) }, check: (v, p) => p !== true || Number.isInteger(v) },
  { id: 'calculation', label: 'Cálculo', description: 'Fórmula, acumulado o expresión numérica del motor existente.', variants: { number: variant(calculationSchema, { kind: 'formula', operator: 'add', leftField: 'a', rightField: 'b' }, 2), currency: variant(calculationSchema, { kind: 'formula', operator: 'add', leftField: 'a', rightField: 'b' }, '2.00') }, check: metadata },
  { id: 'maxDecimals', label: 'Máximo de decimales', description: 'Máximo de cifras decimales del número, de 0 a 15.', variants: { number: variant(count.max(15), 2, 1.25) }, check: (v, p) => {
    const [mantissa, exponent = '0'] = String(v).toLowerCase().split('e')
    return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent)) <= Number(p)
  } },
  { id: 'multipleOf', label: 'Múltiplo de', description: 'Exige múltiplo de un número positivo; tolera redondeo de coma flotante.', variants: { number: variant(numeric.positive(), 0.5, 1.5) }, check: (v, p) => { const q = Number(v) / Number(p); return Number.isFinite(q) && Math.abs(q - Math.round(q)) <= Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(q)) * 8) } },
  { id: 'positive', label: 'Positivo', description: 'Exige número estrictamente mayor que cero.', variants: { number: variant(z.boolean(), true, 2) }, check: (v, p) => p !== true || Number(v) > 0 },
  { id: 'currency', label: 'Moneda', description: 'Código ISO de tres letras o tenant para la moneda de la organización.', variants: { currency: variant(z.union([z.literal('tenant'), z.string().regex(/^[A-Z]{3}$/)]).default('tenant'), 'tenant', '2.00') }, check: metadata },
  { id: 'decimals', label: 'Decimales monetarios', description: 'Máximo de 0 a 4 decimales; por defecto 2.', variants: { currency: variant(count.max(4).default(2), 2, '2.00') }, check: (v, p) => { const text = String(v); return /^-?\d+(?:\.\d+)?$/.test(text) && (text.split('.')[1]?.length ?? 0) <= Number(p) } },
  { id: 'allowNegative', label: 'Permitir negativos', description: 'Permite montos negativos; por defecto falso.', variants: { currency: variant(z.boolean().default(false), false, '2.00') }, check: (v, p) => p === true || Number(v) >= 0 },
  { id: 'minRelative', label: 'Fecha mínima relativa', description: 'Hoy más o menos N días civiles de la organización, inclusive.', variants: { date: variant(z.number().int().min(-36500).max(36500), 0, '2026-10-01') }, check: (v, p, c) => dateDay(v, c.timezone) >= relativeDay(p, c) },
  { id: 'maxRelative', label: 'Fecha máxima relativa', description: 'Hoy más o menos N días civiles de la organización, inclusive.', variants: { date: variant(z.number().int().min(-36500).max(36500), 0, '2026-10-01') }, check: (v, p, c) => dateDay(v, c.timezone) <= relativeDay(p, c) },
  { id: 'after', label: 'Posterior a otro campo', description: 'Fecha estrictamente posterior al campo indicado; no compara si alguno está vacío.', variants: { date: variant(fieldName, 'inicio', '2026-10-01') }, check: (v, p, c) => c.record?.[String(p)] == null || c.record[String(p)] === '' || dateDay(v, c.timezone) > dateDay(c.record[String(p)], c.timezone) },
  { id: 'before', label: 'Anterior a otro campo', description: 'Fecha estrictamente anterior al campo indicado; no compara si alguno está vacío.', variants: { date: variant(fieldName, 'fin', '2026-10-01') }, check: (v, p, c) => c.record?.[String(p)] == null || c.record[String(p)] === '' || dateDay(v, c.timezone) < dateDay(c.record[String(p)], c.timezone) },
  { id: 'mustBeTrue', label: 'Aceptación obligatoria', description: 'Debe aceptar la casilla.', variants: { boolean: variant(z.boolean(), true, true) }, check: (v, p) => p !== true || v === true },
  { id: 'options', label: 'Opciones', description: 'Opciones con value único, etiqueta y color opcional.', variants: { select: variant(options, [{ value: 'nuevo', label: 'Nuevo' }], 'nuevo'), multiselect: variant(options, [{ value: 'nuevo', label: 'Nuevo' }], ['nuevo']) }, check: (v, p) => (Array.isArray(v) ? v : [v]).every(value => (p as Array<{ value: string }>).some(option => option.value === value)) },
  { id: 'minSelections', label: 'Selecciones mínimas', description: 'Número mínimo de opciones seleccionadas.', variants: { multiselect: variant(count.max(10000), 1, ['nuevo']) }, check: (v, p) => Array.isArray(v) && v.length >= Number(p) },
  { id: 'maxSelections', label: 'Selecciones máximas', description: 'Número máximo de opciones seleccionadas.', variants: { multiselect: variant(count.max(10000), 2, ['nuevo']) }, check: (v, p) => Array.isArray(v) && v.length <= Number(p) },
  { id: 'relationEntity', label: 'Entidad relacionada', description: 'Slug de la entidad destino.', variants: { relation: variant(fieldName, 'clientes', '00000000-0000-4000-8000-000000000001') }, check: metadata },
  { id: 'eligibleFilter', label: 'Filtro de elegibilidad', description: 'Solo admite registros activos de la entidad destino cuyo campo coincide con value.', variants: { relation: variant(z.object({ field: fieldName, value: z.union([z.string().max(500), numeric, z.boolean()]) }).strict(), { field: 'activo', value: true }, '00000000-0000-4000-8000-000000000001') }, reference: 'relation', check: (_v, p, c) => c.target === undefined || (c.target !== null && c.target[(p as { field: string }).field] === (p as { value: unknown }).value) },
  { id: 'multiple', label: 'Varios usuarios', description: 'Admite un array de identificadores de usuario.', variants: { user: variant(z.boolean(), true, ['00000000-0000-4000-8000-000000000001']) }, check: metadata },
  { id: 'roles', label: 'Roles de usuario', description: 'Roles elegibles, comprobados por el motor de usuarios.', variants: { user: variant(z.array(z.string().min(1)), ['Doctor'], '00000000-0000-4000-8000-000000000001') }, check: metadata },
  { id: 'defaultCurrentUser', label: 'Usuario actual', description: 'Al crear sin valor usa el usuario autenticado.', variants: { user: variant(z.boolean(), true, '00000000-0000-4000-8000-000000000001') }, check: metadata },
  { id: 'unique', label: 'Usuario único', description: 'Conserva la unicidad de Usuario existente; no disponible en otros tipos.', variants: { user: variant(z.boolean(), true, '00000000-0000-4000-8000-000000000001') }, check: metadata },
  { id: 'allowedTypes', label: 'Tipos de archivo', description: 'Tipos del catálogo fijo, solo para este campo; exige MIME y extensión persistidos en el servidor.', variants: { file: variant(z.array(z.enum(FIELD_FILE_TYPE_IDS)).min(1), ['application/pdf'], '00000000-0000-4000-8000-000000000001') }, reference: 'file', check: (_v, p, c) => c.file === undefined || (c.file !== null && matchesAllowedFieldFileType(p as string[], c.file)) },
  { id: 'maxSizeBytes', label: 'Tamaño máximo', description: 'Máximo en bytes, nunca superior a 15 MB; se comprueba con metadata del servidor.', variants: { file: variant(z.number().int().positive().max(MAX_FILE_SIZE_BYTES), 1048576, '00000000-0000-4000-8000-000000000001') }, reference: 'file', check: (_v, p, c) => c.file === undefined || (c.file !== null && c.file.sizeBytes <= Number(p)) },
  { id: 'columns', label: 'Columnas de tabla', description: 'Columnas con nombre técnico único y tipos simples.', variants: { tabla: variant(columns, [{ name: 'cantidad', label: 'Cantidad', type: 'number' }], [{ cantidad: 1 }]) }, check: metadata },
  { id: 'minRows', label: 'Filas mínimas', description: 'Cantidad mínima de filas en la tabla.', variants: { tabla: variant(count.max(10000), 1, [{ cantidad: 1 }]) }, check: (v, p) => Array.isArray(v) && v.length >= Number(p) },
  { id: 'maxRows', label: 'Filas máximas', description: 'Cantidad máxima de filas en la tabla.', variants: { tabla: variant(count.max(10000), 10, [{ cantidad: 1 }]) }, check: (v, p) => Array.isArray(v) && v.length <= Number(p) },
  { id: 'digits', label: 'Dígitos del consecutivo', description: 'Entre 1 y 15 dígitos, generado por el servidor.', variants: { incremental: variant(z.number().int().min(1).max(15), 6, '000001') }, check: metadata },
  { id: 'prefix', label: 'Prefijo fijo', description: 'De 1 a 20 letras ASCII, números, guiones o guiones bajos.', variants: { incremental: variant(z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/), 'FAC-', 'FAC-000001') }, check: metadata },
  { id: 'prefixSource', label: 'Origen del prefijo', description: 'Campo relation propio y campo de texto de su entidad destino.', variants: { incremental: variant(z.object({ relationField: fieldName, sourceField: fieldName }).strict(), { relationField: 'cliente', sourceField: 'codigo' }, 'CLI000001') }, check: metadata }
]

const mandatory = new Set(['options', 'columns', 'digits'])
export function registryRulesSchema(dataType: string): z.ZodTypeAny | null {
  if (!DATA_TYPES.includes(dataType as typeof DATA_TYPES[number])) return null
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const rule of FIELD_VALIDATIONS) {
    const definition = rule.variants[dataType as typeof DATA_TYPES[number]]
    if (definition) shape[rule.id] = mandatory.has(rule.id) || definition.schema instanceof z.ZodDefault ? definition.schema : definition.schema.optional()
  }
  return z.object(shape).strict().superRefine((rules, ctx) => {
    if (dataType === 'user' && rules.multiple && rules.unique) ctx.addIssue({ code: 'custom', message: 'Un campo Usuario único no puede admitir varios usuarios', path: ['unique'] })
    for (const [min, max] of [['minLength', 'maxLength'], ['min', 'max'], ['minSelections', 'maxSelections'], ['minRows', 'maxRows'], ['minRelative', 'maxRelative']]) {
      if (rules[min] !== undefined && rules[max] !== undefined && rules[min] > rules[max]) ctx.addIssue({ code: 'custom', message: 'El mínimo no puede superar al máximo', path: [max] })
    }
    if (dataType === 'date' && rules.default === 'today' && (Number(rules.minRelative ?? 0) > 0 || Number(rules.maxRelative ?? 0) < 0)) ctx.addIssue({ code: 'custom', message: 'Hoy no cumple el rango relativo configurado', path: ['default'] })
    if (rules.default !== undefined && !(dataType === 'date' && rules.default === 'today') && !registryFieldType({ name: 'default', dataType, validationRules: { ...rules, default: undefined }, isRequired: true }).safeParse(rules.default).success) ctx.addIssue({ code: 'custom', message: 'El valor predeterminado no cumple las reglas del campo', path: ['default'] })
    if (dataType === 'relation' && rules.eligibleFilter && !rules.relationEntity) ctx.addIssue({ code: 'custom', message: 'El filtro requiere una entidad destino', path: ['eligibleFilter'] })
  })
}

function baseType(dataType: string, rules: Rules, required: boolean): z.ZodTypeAny {
  switch (dataType) {
    case 'text': return z.string()
    case 'number': return z.number().finite()
    case 'currency': return z.union([z.string(), z.number().finite()]).transform(v => String(v).trim())
    case 'boolean': return z.boolean()
    case 'date': return z.coerce.date()
    case 'relation': case 'file': return z.string().uuid()
    case 'user': return rules.multiple ? (required ? z.array(z.string().uuid()).min(1) : z.array(z.string().uuid())) : z.string().uuid()
    case 'select': return z.string()
    case 'multiselect': return z.array(z.string()).refine(values => new Set(values).size === values.length, 'No se puede seleccionar una opción más de una vez')
    case 'tabla': return z.array(z.object(Object.fromEntries((Array.isArray(rules.columns) ? rules.columns as Array<{ name: string; type: string }> : []).map(col => [col.name, baseType(col.type, {}, true)]))))
    case 'json': return z.union([z.record(z.unknown()), z.array(z.unknown())])
    case 'incremental': return z.string().optional().nullable()
    default: return z.unknown()
  }
}
export function normalizeFieldValue(dataType: string, rules: Rules, value: unknown): unknown {
  if (dataType === 'date' && value === '') return null
  if (dataType !== 'text' || typeof value !== 'string') return value
  let normalized = value
  for (const rule of FIELD_VALIDATIONS) if (rule.normalize && rule.variants.text && rules[rule.id] !== undefined) normalized = rule.normalize(normalized, rules[rule.id])
  return normalized
}
export function registryFieldType(field: EntityFieldRow, context: ValidationContext = {}): z.ZodTypeAny {
  const rules = { ...((field.validationRules ?? {}) as Rules) }
  if (field.dataType === 'currency') { rules.decimals ??= 2; rules.allowNegative ??= false }
  let base = baseType(field.dataType, rules, field.isRequired)
  if (field.dataType === 'incremental') return base
  if (!field.isRequired && !(field.dataType === 'boolean' && rules.mustBeTrue === true)) base = base.optional().nullable()
  // Conserva el valor original de Fecha para no convertir un día civil en el día anterior por UTC.
  return z.unknown().transform((input, ctx) => {
    const value = normalizeFieldValue(field.dataType, rules, input)
    if (field.dataType === 'date' && typeof value === 'string' && !validDateString(value)) { ctx.addIssue({ code: 'custom', message: 'Debe ser una fecha ISO válida' }); return z.NEVER }
    if (field.dataType === 'date' && field.isRequired && value == null) { ctx.addIssue({ code: 'custom', message: 'La fecha es obligatoria' }); return z.NEVER }
    const parsed = base.safeParse(value, { errorMap: issue => ({ message: issue.code === 'custom' ? issue.message ?? 'El valor no cumple la regla' : issue.code === 'invalid_string' ? 'Debe ser un identificador válido' : `El valor no es válido para el tipo de campo ${field.dataType}` }) })
    if (!parsed.success) { for (const issue of parsed.error.issues) ctx.addIssue(issue); return z.NEVER }
    if (value == null) return parsed.data
    // pattern/enum heredadas se ignoran; nunca se compilan expresiones del usuario.
    for (const rule of FIELD_VALIDATIONS) {
      if (!rule.variants[field.dataType as typeof DATA_TYPES[number]] || rules[rule.id] === undefined || ['after', 'before'].includes(rule.id)) continue
      const comparable = field.dataType === 'date' ? value : parsed.data
      if (!rule.check(comparable, rules[rule.id], context, rules)) ctx.addIssue({ code: 'custom', message: `${rule.label}: ${rule.description}` })
    }
    return parsed.data
  })
}
export function buildRecordSchema(fields: EntityFieldRow[], context: ValidationContext = {}): z.ZodTypeAny {
  return z.preprocess(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input
    const data = { ...(input as Rules) }
    for (const field of fields) data[field.name] = normalizeFieldValue(field.dataType, (field.validationRules ?? {}) as Rules, data[field.name])
    return data
  }, z.unknown().transform((input, ctx) => {
    const record = input as Rules
    const parsed = z.object(Object.fromEntries(fields.map(field => [field.name, registryFieldType(field, { ...context, record })]))).passthrough().safeParse(input)
    if (!parsed.success) { for (const issue of parsed.error.issues) ctx.addIssue(issue); return z.NEVER }
    for (const field of fields.filter(f => f.dataType === 'date')) {
      const rules = (field.validationRules ?? {}) as Rules
      if (record[field.name] == null || record[field.name] === '') continue
      for (const rule of FIELD_VALIDATIONS.filter(r => ['after', 'before'].includes(r.id))) if (rules[rule.id] !== undefined && !rule.check(record[field.name], rules[rule.id], { ...context, record }, rules)) ctx.addIssue({ code: 'custom', path: [field.name], message: `${rule.label}: ${String(rules[rule.id])}` })
    }
    // Los días civiles se guardan como YYYY-MM-DD; así la conversión UTC no desplaza su día al releerlos.
    for (const field of fields) if (field.dataType === 'date' && typeof record[field.name] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record[field.name] as string)) parsed.data[field.name] = record[field.name]
    return parsed.data
  }))
}
export function applyFieldDefaults(fields: Array<Pick<EntityFieldRow, 'name' | 'dataType' | 'validationRules'>>, input: Rules, context: ValidationContext & { userId?: string } = {}): Rules {
  const data = { ...input }
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input, field.name)) continue
    const rules = (field.validationRules ?? {}) as Rules
    if (FIELD_VALIDATIONS.find(r => r.id === 'default')?.variants[field.dataType as typeof DATA_TYPES[number]] && rules.default !== undefined) data[field.name] = field.dataType === 'date' && rules.default === 'today' ? dateDay(context.now ?? new Date(), context.timezone) : structuredClone(rules.default)
    if (field.dataType === 'user' && rules.defaultCurrentUser === true && context.userId) data[field.name] = rules.multiple ? [context.userId] : context.userId
  }
  return data
}

/** Descriptor JSON sin funciones ni datos de tenant; conserva límites y defaults Zod. */
export function parameterDescriptor(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) return parameterDescriptor(schema.innerType())
  if (schema instanceof z.ZodOptional) return { ...parameterDescriptor(schema.unwrap()), optional: true }
  if (schema instanceof z.ZodDefault) return { ...parameterDescriptor(schema.removeDefault()), default: schema._def.defaultValue() }
  if (schema instanceof z.ZodObject) return { type: 'object', properties: Object.fromEntries(Object.entries(schema.shape as Record<string, z.ZodTypeAny>).map(([id, s]) => [id, parameterDescriptor(s)])) }
  if (schema instanceof z.ZodArray) return { type: 'array', items: parameterDescriptor(schema.element), min: schema._def.minLength?.value, max: schema._def.maxLength?.value }
  if (schema instanceof z.ZodEnum) return { type: 'enum', values: schema.options }
  if (schema instanceof z.ZodLiteral) return { type: 'literal', value: schema.value }
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) return { type: 'union', options: [...schema.options].map(parameterDescriptor) }
  if (schema instanceof z.ZodNumber || schema instanceof z.ZodString) return { type: schema instanceof z.ZodNumber ? 'number' : 'string', limits: schema._def.checks.filter(check => check.kind !== 'regex') }
  return { type: schema instanceof z.ZodBoolean ? 'boolean' : 'unknown' }
}
export function describeFieldValidations() {
  return { types: DATA_TYPES, validations: FIELD_VALIDATIONS.map(rule => ({ id: rule.id, label: rule.label, description: rule.description, types: Object.keys(rule.variants), parameters: Object.fromEntries(Object.entries(rule.variants).map(([type, v]) => [type, { ...parameterDescriptor(v.schema), required: mandatory.has(rule.id), example: v.example }])) })), formats: TEXT_FORMATS.map(({ validate, ...format }) => format), file: { multiple: false, maxSizeBytes: MAX_FILE_SIZE_BYTES, allowedTypes: FIELD_FILE_TYPE_IDS, types: FIELD_FILE_TYPES, typeRestrictionScope: 'fieldsWithAllowedTypes' } }
}
export function validationCapabilitiesPrompt() {
  return `Catálogo exclusivo de validaciones por tipo. Sin pattern ni enum de Texto; usa format o Select. Las reglas no listadas están prohibidas. Parámetros, límites y ejemplos: ${JSON.stringify(describeFieldValidations())}`
}
