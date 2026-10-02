import { FIELD_FILE_TYPES, matchesAllowedFieldFileType } from '../../server/utils/fieldValidations/filePolicy'
import { readFileSync } from 'node:fs'
import { createError } from 'h3'
import { describe, it, expect, vi } from 'vitest'
import { FIELD_VALIDATIONS, DATA_TYPES, applyFieldDefaults, registryFieldType as buildFieldType, buildRecordSchema, dateDay, describeFieldValidations, registryRulesSchema as getValidationRulesSchema, validationCapabilitiesPrompt } from '../../server/utils/fieldValidations/registry'
import { TEXT_FORMATS, validateTextFormat } from '../../server/utils/fieldValidations/formats'
import { blueprintFieldSchema } from '../../server/utils/blueprint/schema'
import { degradeDesignerFields } from '../../server/utils/moduleDesigner/degrade'

const field = (dataType: string, rules: Record<string, unknown>, isRequired = true) => ({ name: 'valor', dataType, validationRules: rules, isRequired })
const context = { now: new Date('2026-10-01T03:00:00Z'), timezone: 'America/Mexico_City' }

describe('fieldValidations: contrato de la fuente única', () => {
  it('ids únicos, metadatos completos, ejemplos de parámetros y valores válidos', () => {
    expect(new Set(FIELD_VALIDATIONS.map(r => r.id)).size).toBe(FIELD_VALIDATIONS.length)
    for (const rule of FIELD_VALIDATIONS) {
      expect(rule.label.trim()).not.toBe('')
      expect(rule.description.trim()).not.toBe('')
      expect(Object.keys(rule.variants).length).toBeGreaterThan(0)
      for (const [type, v] of Object.entries(rule.variants)) {
        expect(v.example, `${type}.${rule.id}`).not.toBeUndefined()
        expect(v.schema.safeParse(v.example).success, `${type}.${rule.id}`).toBe(true)
        const examplesContext = { now: new Date('2026-10-01T18:00:00Z'), timezone: 'America/Mexico_City' }
        expect(rule.check(v.value, v.example, examplesContext, {}), `${type}.${rule.id}`).toBe(true)
        const rules: Record<string, unknown> = { [rule.id]: v.example }
        if (type === 'tabla' && !rules.columns) rules.columns = [{ name: 'cantidad', label: 'Cantidad', type: 'number' }]
        if (type === 'select' || type === 'multiselect') rules.options ??= [{ value: 'nuevo', label: 'Nuevo' }]
        if (type === 'incremental') rules.digits ??= 6
        if (type === 'relation' && rule.id === 'eligibleFilter') rules.relationEntity = 'clientes'
        expect(getValidationRulesSchema(type)?.safeParse(rules).success, `${type}.${rule.id}`).toBe(true)
        expect(buildFieldType(field(type, rules), examplesContext).safeParse(v.value).success, `valor ${type}.${rule.id}`).toBe(true)
      }
    }
  })
  it('esquema estricto y prompt cubren exactamente las capacidades del registro', () => {
    const catalog = describeFieldValidations()
    for (const type of DATA_TYPES) for (const rule of FIELD_VALIDATIONS) {
      expect(validationCapabilitiesPrompt()).toContain(rule.description)
      const applicable = Boolean(rule.variants[type])
      expect(catalog.validations.find(r => r.id === rule.id)?.types.includes(type)).toBe(applicable)
    }
    expect(getValidationRulesSchema('inventado')).toBeNull()
    expect(catalog.file.typeRestrictionScope).toBe('fieldsWithAllowedTypes')
    expect(catalog.file.types).toEqual(FIELD_FILE_TYPES)
    expect(getValidationRulesSchema('text')?.safeParse({ unique: true }).success).toBe(false)
    expect(getValidationRulesSchema('number')?.safeParse({ unique: true }).success).toBe(false)
  })
  it('blueprint acepta formatos válidos y degrada un format desconocido como regla individual', () => {
    expect(blueprintFieldSchema.safeParse({ name: 'correo', label: 'Correo', dataType: 'text', validationRules: { format: 'email' } }).success).toBe(true)
    expect(blueprintFieldSchema.safeParse({ name: 'correo', label: 'Correo', dataType: 'text', validationRules: { format: 'libre' } }).success).toBe(false)
    const blueprint = { version: 1 as const, summary: 'CRM', modules: [{ ref: 'crm', action: 'create' as const, kind: 'hecho' as const, name: 'CRM', slug: 'crm', fields: [{ name: 'correo', label: 'Correo', dataType: 'text' as const, validationRules: { format: 'libre', maxLength: 100 } }] }], associations: [] }
    const result = degradeDesignerFields(blueprint, [{ path: 'modules[0].fields[0].validationRules.format', message: 'Formato inválido', ruleKey: 'format' }], { version: 1, summary: 'Actual', modules: [], associations: [] })
    expect(result.warnings).toHaveLength(1)
    const degraded = result.blueprint as typeof blueprint
    expect(degraded.modules[0].fields[0].validationRules).toEqual({ maxLength: 100 })
    expect(blueprintFieldSchema.safeParse(degraded.modules[0].fields[0]).success).toBe(true)
  })
})

describe('formatos guiados', () => {
  const invalid: Record<string, string> = { email: 'sin-correo', phoneMx: '+1 4771234567', url: 'javascript:alert(1)', rfc: 'GODE569931GR8', curp: 'GODE569931HDFRRN09', postalCodeMx: '1234', lettersOnly: 'Ana 2', digitsOnly: '12.5', alphanumeric: 'A-2' }
  for (const format of TEXT_FORMATS) it(`${format.id}: ejemplo, rechazo y entrada adversaria acotada`, () => {
    expect(validateTextFormat(format.id, format.example)).toBe(true)
    expect(validateTextFormat(format.id, invalid[format.id])).toBe(false)
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      expect(validateTextFormat(format.id, 'a'.repeat(100000) + '!')).toBe(false)
      expect(validateTextFormat(format.id, ' '.repeat(format.maxLength) + '!')).toBe(false)
    }
    expect(performance.now() - start).toBeLessThan(1000)
  })
  it('límites, variantes de teléfono y formatos ajenos', () => {
    for (const value of ['4771234567', '52 477-123-4567', '+52 477 123 4567']) expect(validateTextFormat('phoneMx', value)).toBe(true)
    for (const value of ['+4771234567', '47712345678', '(477)1234567', '4771234567 ext 2']) expect(validateTextFormat('phoneMx', value)).toBe(false)
    expect(validateTextFormat('libre', 'algo')).toBe(false)
    expect(validateTextFormat('url', 'https://usuario:clave@example.com')).toBe(false)
    expect(validateTextFormat('rfc', 'ABC000229AB1')).toBe(true)
    expect(validateTextFormat('rfc', 'ABC230229AB1')).toBe(false)
  })
})

describe('aplicación de reglas', () => {
  it('normaliza trim/case antes de validar y da mensajes españoles sin regex', () => {
    const schema = buildFieldType(field('text', { trim: true, case: 'upper', minLength: 2, maxLength: 3, notBlank: true, format: 'lettersOnly' }))
    expect(schema.parse(' áb ')).toBe('ÁB')
    expect(schema.safeParse('   ').success).toBe(false)
    const result = schema.safeParse('A1')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toContain('Formato guiado')
    expect(buildFieldType(field('text', { case: 'lower' })).parse('ANA')).toBe('ana')
  })
  it.each([
    ['maxDecimals', 2, 1.25, 1.251], ['multipleOf', 0.1, 0.3, 0.31], ['positive', true, 1, 0]
  ])('Número %s', (key, rule, valid, invalid) => {
    const schema = buildFieldType(field('number', { [String(key)]: rule }))
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse(invalid).success).toBe(false)
  })
  it('decimales con notación científica y límites de parámetros', () => {
    expect(buildFieldType(field('number', { maxDecimals: 5 })).safeParse(1e-6).success).toBe(false)
    for (const [type, rules] of [['number', { multipleOf: 0 }], ['number', { maxDecimals: 16 }], ['file', { maxSizeBytes: 16 * 1024 * 1024 }], ['file', { allowedTypes: ['text/html'] }], ['tabla', { columns: [{ name: 'n', label: 'N', type: 'number' }], minRows: -1 }]] as const) expect(getValidationRulesSchema(type)?.safeParse(rules).success).toBe(false)
  })
  it('aceptación obligatoria, multiselección y filas', () => {
    const consent = buildFieldType(field('boolean', { mustBeTrue: true }, false))
    expect(consent.safeParse(true).success).toBe(true)
    for (const value of [false, null, undefined]) expect(consent.safeParse(value).success).toBe(false)
    const multi = buildFieldType(field('multiselect', { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], minSelections: 1, maxSelections: 1 }))
    expect(multi.safeParse(['a']).success).toBe(true)
    expect(multi.safeParse([]).success).toBe(false)
    expect(multi.safeParse(['a', 'b']).success).toBe(false)
    const table = buildFieldType(field('tabla', { columns: [{ name: 'n', label: 'N', type: 'number' }], minRows: 1, maxRows: 1 }))
    expect(table.safeParse([{ n: 1 }]).success).toBe(true)
    expect(table.safeParse([]).success).toBe(false)
    expect(table.safeParse([{ n: 1 }, { n: 2 }]).success).toBe(false)
  })
  it('fechas relativas usan el día de la organización en cada evaluación, sin cachear hoy', () => {
    expect(dateDay(context.now, context.timezone)).toBe('2026-09-30')
    const schema = buildRecordSchema([field('date', { minRelative: 0, maxRelative: 1 })], context)
    expect(schema.safeParse({ valor: '2026-09-30' }).success).toBe(true)
    expect(schema.safeParse({ valor: '2026-10-01' }).success).toBe(true)
    expect(schema.safeParse({ valor: '2026-09-29' }).success).toBe(false)
    expect(schema.safeParse({ valor: '2026-10-02' }).success).toBe(false)
    const utc = buildRecordSchema([field('date', { minRelative: 0 })], { ...context, timezone: 'UTC' })
    expect(utc.safeParse({ valor: '2026-09-30' }).success).toBe(false)
  })
  it('after/before exigen orden estricto y toleran vacíos', () => {
    const schema = buildRecordSchema([field('date', { after: 'inicio', before: 'fin' }, false)], context)
    expect(schema.safeParse({ valor: '2026-10-01', inicio: '2026-09-30', fin: '2026-10-02' }).success).toBe(true)
    expect(schema.safeParse({ valor: '2026-10-01', inicio: '2026-10-01' }).success).toBe(false)
    expect(schema.safeParse({ valor: '2026-10-01', fin: '2026-09-30' }).success).toBe(false)
    expect(schema.safeParse({ valor: '2026-10-01', inicio: null, fin: '' }).success).toBe(true)
    expect(schema.safeParse({ valor: null, inicio: '2026-10-01' }).success).toBe(true)
    expect(schema.safeParse({ valor: '', inicio: '2026-10-01' }).success).toBe(true)
    expect(schema.safeParse({ valor: '2026-02-30' }).success).toBe(false)
  })
  it('predeterminados solo en creación y sin sobrescribir valores enviados', () => {
    const fields = [field('date', { default: 'today' }), { ...field('user', { defaultCurrentUser: true }), name: 'autor' }]
    expect(applyFieldDefaults(fields, {}, { ...context, userId: 'usuario' })).toEqual({ valor: '2026-09-30', autor: 'usuario' })
    expect(applyFieldDefaults(fields, { valor: null, autor: null }, { ...context, userId: 'usuario' })).toEqual({ valor: null, autor: null })
    for (const [type, value] of [['text', 'Ana'], ['number', 2], ['currency', '1.00'], ['boolean', false], ['date', '2026-10-01'], ['select', 'a'], ['multiselect', ['a']]] as const) {
      expect(applyFieldDefaults([field(type, { default: value })], {}, context)).toEqual({ valor: value })
      expect(applyFieldDefaults([field(type, { default: value })], { valor: 'enviado' }, context)).toEqual({ valor: 'enviado' })
    }
    expect(getValidationRulesSchema('text')?.safeParse({ default: 'today', maxLength: 2 }).success).toBe(false)
    expect(getValidationRulesSchema('select')?.safeParse({ options: [{ value: 'a', label: 'A' }], default: 'b' }).success).toBe(false)
  })
  it('heredadas no rompen lectura y no se pueden guardar', () => {
    const rules = { pattern: '(a+)+$', enum: ['a'] }
    expect(buildFieldType(field('text', rules)).safeParse('fuera de la lista').success).toBe(true)
    expect(getValidationRulesSchema('text')?.safeParse(rules).success).toBe(false)
    expect(blueprintFieldSchema.safeParse({ name: 'a', label: 'A', dataType: 'text', validationRules: rules }).success).toBe(false)
  })
})

describe('endpoint de catálogo', () => {
  it('exige autenticación y no incluye datos del tenant', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', createError)
    const { default: handler } = await import('../../server/api/field-validations.get')
    expect(() => handler({ context: {} } as never)).toThrow()
    expect(handler({ context: { auth: { sub: 'usuario', tenantId: 'organización', roleId: 'rol' } } } as never)).toEqual(describeFieldValidations())
    expect(JSON.stringify(describeFieldValidations())).not.toContain('tenantId')
    vi.unstubAllGlobals()
  })
})


describe('HU-ERD-152: generación del CRM sin red', () => {
  it('reproduce un CRM real archivado con el prompt solicitado y propone reglas nuevas derivadas', async () => {
    const { runDesignerGeneration } = await import('../../server/utils/moduleDesigner/generate')
    const { validateBlueprintAgainstSnapshot } = await import('../../server/utils/blueprint/validate')
    const { blueprintSchema } = await import('../../server/utils/blueprint/schema')
    const current = { version: 1 as const, summary: 'Actual', modules: [], associations: [] }
    const crm = blueprintSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/hu152-crm.json', import.meta.url), 'utf8')))
    const instruction = readFileSync(new URL('../fixtures/hu152-crm-prompt.txt', import.meta.url), 'utf8')
    const module = crm.modules.find(item => item.kind === 'hecho')!
    module.fields.push({ name: 'correo152', label: 'Correo validado', dataType: 'text', validationRules: { format: 'email', trim: true, case: 'lower' } })
    const complete = vi.fn(async (_input: { system: string; prompt: string }) => ({ value: { message: 'CRM', blueprint: crm, omissions: [] }, inputTokens: 10, outputTokens: 20, model: 'simulado' }))
    const result = await runDesignerGeneration({ current, blueprint: current, conversation: [], instruction, complete, validate: proposal => validateBlueprintAgainstSnapshot(proposal, current) })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].system).toContain(validationCapabilitiesPrompt())
    expect(result.result?.normalized?.modules.flatMap(module => module.fields).find(field => field.name === 'correo152')?.validationRules).toEqual({ format: 'email', trim: true, case: 'lower' })
  })
})


describe('Archivo: catálogo por campo, MIME y extensión', () => {
  for (const type of FIELD_FILE_TYPES) it(`${type.id}: variantes MIME y extensiones del catálogo`, () => {
    expect(getValidationRulesSchema('file')?.safeParse({ allowedTypes: [type.id] }).success).toBe(true)
    for (const mimeType of type.mimeTypes) for (const extension of type.extensions) {
      expect(matchesAllowedFieldFileType([type.id], { mimeType, fileName: `archivo.${extension.toUpperCase()}` })).toBe(true)
      expect(matchesAllowedFieldFileType([type.id], { mimeType, fileName: 'archivo.exe' })).toBe(false)
      expect(matchesAllowedFieldFileType([type.id], { mimeType: 'application/octet-stream', fileName: `archivo.${extension}` })).toBe(false)
    }
  })
  it('sin allowedTypes, ni maxSizeBytes solo restringen tipos', () => {
    const metadata = { mimeType: 'video/mp4', fileName: 'video.mp4', sizeBytes: 100 }
    const id = '00000000-0000-4000-8000-000000000001'
    for (const rules of [{}, { maxSizeBytes: 100 }]) expect(buildFieldType(field('file', rules), { file: metadata }).safeParse(id).success).toBe(true)
    expect(buildFieldType(field('file', { allowedTypes: ['application/pdf'] }), { file: metadata }).safeParse(id).success).toBe(false)
    expect(matchesAllowedFieldFileType(['application/pdf'], { mimeType: 'application/pdf', fileName: 'pdf' })).toBe(false)
  })
})
