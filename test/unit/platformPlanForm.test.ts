import { describe, expect, it } from 'vitest'
import { dateTimeLocalToIso, formatPlanPrice, normalizeOverrideValue, normalizePlanLimits, priceInputToCents } from '../../utils/platformPlanForm'
import { PLAN_CONCEPTS } from '../../utils/planConcepts'

describe('formulario de planes de plataforma', () => {
  it('conserva todos los conceptos y convierte vacío en ilimitado', () => {
    const limits = normalizePlanLimits({ users: '15', sites: '', pages: null })
    expect(Object.keys(limits)).toEqual([...PLAN_CONCEPTS])
    expect(limits.users).toBe(15)
    expect(limits.sites).toBeNull()
    expect(limits.pages).toBeNull()
  })

  it('muestra MXN y guarda los precios informativos en centavos', () => {
    expect(priceInputToCents('149.99')).toBe(14999)
    expect(formatPlanPrice(14999)).toContain('149.99')
  })

  it('convierte la vigencia local al ISO requerido por la API', () => {
    expect(dateTimeLocalToIso('2026-09-27T12:30')).toBe(new Date('2026-09-27T12:30').toISOString())
    expect(dateTimeLocalToIso('')).toBeNull()
  })

  it('conserva la excepción vacía como ilimitada', () => {
    expect(normalizeOverrideValue('', false)).toBeNull()
    expect(normalizeOverrideValue('15', false)).toBe(15)
    expect(normalizeOverrideValue('15', true)).toBeNull()
  })
})
