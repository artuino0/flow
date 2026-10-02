import { describe, expect, it } from 'vitest'
import { describeFieldValidations, registryRulesSchema, registryFieldType, validationCapabilitiesPrompt } from '~/server/utils/fieldValidations/registry'
import { validateFieldValue, normalizeClientText } from '~/utils/validateFieldValue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
const field: EntityFieldMeta = { id: 'text', name: 'text', label: 'Texto', dataType: 'text', validationRules: {}, isRequired: false }
describe('display y cliente HU-153', () => {
  it('catálogo/prompt/esquema comparten display con default absolute; no valida valores', () => {
    const rule = describeFieldValidations().validations.find(v => v.id === 'display')!
    expect(rule.types).toEqual(['date'])
    expect(rule.parameters.date).toMatchObject({ type: 'enum', values: ['absolute', 'relative', 'both'], default: 'absolute', example: 'relative' })
    expect(validationCapabilitiesPrompt()).toContain(rule.description)
    expect(registryRulesSchema('date')!.parse({})).toEqual({ display: 'absolute' })
    for (const display of ['absolute', 'relative', 'both']) {
      expect(registryRulesSchema('date')!.safeParse({ display }).success).toBe(true)
      expect(registryFieldType({ name: 'fecha', dataType: 'date', validationRules: { display }, isRequired: true }).safeParse('2026-10-01').success).toBe(true)
    }
    expect(registryRulesSchema('date')!.safeParse({ display: 'otro' }).success).toBe(false)
    expect(registryRulesSchema('text')!.safeParse({ display: 'relative' }).success).toBe(false)
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
