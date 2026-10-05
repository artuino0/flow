import { describe, expect, it, vi } from 'vitest'
vi.mock('~/server/db', () => ({ db: {}, withTenant: vi.fn() }))
import { platformClientMrr, platformClientSource, platformClientState, platformCrmBlueprint } from '../../server/utils/platformCrm'
import { blueprintSchema } from '../../server/utils/blueprint/schema'
import { MODULE_ICON_KEYS } from '../../server/utils/moduleIcons'

describe('CRM plataforma: contratos comerciales y catálogo existente', () => {
  it.each([['trialing', 'En prueba'], ['active', 'Activo'], ['past_due', 'Impago'], ['unpaid', 'Impago'], ['canceled', 'Cancelado'], ['incomplete_expired', 'Cancelado']])('%s → %s', (status, expected) => expect(platformClientState(status, false)).toBe(expected))
  it('sin contratación distingue prospecto de cancelado', () => {
    expect(platformClientState(null, true)).toBe('Prospecto')
    expect(platformClientState(null, false)).toBe('Cancelado')
  })
  it('MRR en pesos con redondeo monetario, anual/12, manual, sin precio y moneda distinta', () => {
    expect(platformClientMrr('stripe', 'month', 159900, 1500000)).toBe('1599.00')
    expect(platformClientMrr('stripe', 'year', 159900, 1500000)).toBe('1250.00')
    expect(platformClientMrr('stripe', 'year', 0, 10000)).toBe('8.33')
    expect(platformClientMrr('manual', 'month', 159900, 1500000)).toBe('0.00')
    expect(platformClientMrr('stripe', 'month', null, null)).toBe('0.00')
    expect(platformClientMrr('stripe', 'month', 1000, 0, 'USD')).toBe('0.00')
  })
  it('atribución usa normalización HU-186, excluye identidad y no incluye expiry', () => {
    expect(platformClientSource({ plan: 'starter', utm_source: 'landing', ref: 'persona@ejemplo.test', correo: 'privado@ejemplo.test', expiresAt: '2000-01-01' })).toBe('plan=starter; interval=month; utm_source=landing')
    expect(platformClientSource({ plan: 'empresarial' })).toBe('')
  })
  it('blueprint válido, icono existente, campos y tipos reales; no plantilla Agenda', () => {
    expect(blueprintSchema.safeParse(platformCrmBlueprint).success).toBe(true)
    const module = platformCrmBlueprint.modules[0]!
    expect(MODULE_ICON_KEYS).toContain(module.icon)
    expect(module.systemTemplate).toBeUndefined()
    expect(module.fields).toHaveLength(19)
    expect(module.description).toContain('campos propios se conservan')
    expect(module.fields.find(f => f.name === 'mrr')?.validationRules).toEqual({ currency: 'MXN', decimals: 2 })
    expect(module.fields.find(f => f.name === 'notas')?.dataType).toBe('text')
  })
})
