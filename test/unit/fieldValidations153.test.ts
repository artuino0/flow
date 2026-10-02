import { describe, expect, it } from 'vitest'
import { describeFieldValidations, registryRulesSchema, registryFieldType, validationCapabilitiesPrompt } from '~/server/utils/fieldValidations/registry'
import { validateFieldValue, normalizeClientText } from '~/utils/validateFieldValue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
const field: EntityFieldMeta = { id: 'text', name: 'text', label: 'Texto', dataType: 'text', validationRules: {}, isRequired: false }
describe('display y cliente HU-153', () => {
  it('el diseñador deriva prompt y esquema del registro nuevo sin llamadas a IA', async () => {
    const { DESIGNER_SYSTEM_PROMPT } = await import('~/server/utils/moduleDesigner/generate')
    const { blueprintFieldSchema } = await import('~/server/utils/blueprint/schema')
    expect(DESIGNER_SYSTEM_PROMPT).toContain(validationCapabilitiesPrompt())
    expect(DESIGNER_SYSTEM_PROMPT).toContain('"id":"dateFormat"')
    expect(DESIGNER_SYSTEM_PROMPT).toContain('"id":"showRelative"')
    expect(DESIGNER_SYSTEM_PROMPT).not.toContain('"id":"display"')
    const draft = { name: 'fecha', label: 'Fecha', dataType: 'date' }
    expect(blueprintFieldSchema.safeParse({ ...draft, validationRules: { dateFormat: 'long', showRelative: true } }).success).toBe(true)
    expect(blueprintFieldSchema.safeParse({ ...draft, validationRules: { display: 'both' } }).success).toBe(false)
  })
  it('catálogo/prompt/esquema ofrecen formato y relativo; rechazan display al guardar', () => {
    const catalog = describeFieldValidations()
    expect(catalog.validations.some(v => v.id === 'display')).toBe(false)
    const format = catalog.validations.find(v => v.id === 'dateFormat')!
    const relative = catalog.validations.find(v => v.id === 'showRelative')!
    expect(format.types).toEqual(['date']); expect(relative.types).toEqual(['date'])
    expect(format.parameters.date).toMatchObject({ type: 'enum', values: ['short', 'medium', 'long'], default: 'short', example: 'medium' })
    expect(relative.parameters.date).toMatchObject({ type: 'boolean', default: false, example: true })
    expect(validationCapabilitiesPrompt()).toContain(format.description)
    expect(validationCapabilitiesPrompt()).toContain(relative.description)
    expect(validationCapabilitiesPrompt()).not.toContain('"id":"display"')
    expect(registryRulesSchema('date')!.parse({})).toEqual({ dateFormat: 'short', showRelative: false })
    for (const dateFormat of ['short', 'medium', 'long']) for (const showRelative of [true, false]) {
      expect(registryRulesSchema('date')!.safeParse({ dateFormat, showRelative }).success).toBe(true)
      expect(registryFieldType({ name: 'fecha', dataType: 'date', validationRules: { dateFormat, showRelative }, isRequired: true }).safeParse('2026-10-01').success).toBe(true)
    }
    for (const display of ['absolute', 'both', 'relative', 'otro']) expect(registryRulesSchema('date')!.safeParse({ display }).success).toBe(false)
    expect(registryRulesSchema('date')!.safeParse({ dateFormat: 'otro' }).success).toBe(false)
    expect(registryRulesSchema('date')!.safeParse({ showRelative: 'true' }).success).toBe(false)
    expect(registryRulesSchema('text')!.safeParse({ dateFormat: 'short' }).success).toBe(false)
  })
  it('ignora pattern/enum heredadas, normaliza sin modificar el original y usa mensajes del catálogo', () => {
    expect(validateFieldValue({ ...field, validationRules: { pattern: '[', enum: ['otro'] } }, 'Ana').valid).toBe(true)
    expect(normalizeClientText(' Ana ', { trim: true, case: 'upper' })).toBe('ANA')
    expect(normalizeClientText(' ANA ', { trim: true, case: 'lower' })).toBe('ana')
    for (const [rules, value, id] of [[{ minLength: 4, trim: true }, ' Ana ', 'minLength'], [{ maxLength: 2 }, 'Ana', 'maxLength'], [{ notBlank: true }, ' ', 'notBlank'], [{ notBlank: true }, '', 'notBlank']] as const) {
      const rule = describeFieldValidations().validations.find(v => v.id === id)!
      expect(validateFieldValue({ ...field, validationRules: rules }, value)).toEqual({ valid: false, error: `${rule.label}: ${rule.description}` })
    }
    expect(validateFieldValue({ ...field, validationRules: { format: 'email' } }, 'incompleto').valid).toBe(true) // Autoridad del servidor.
  })
})
