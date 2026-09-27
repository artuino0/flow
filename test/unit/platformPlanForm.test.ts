import { describe, expect, it } from 'vitest'
import { bytesToGb, dateTimeLocalToIso, formatPlanPrice, gbToBytes, normalizeOverrideValue, normalizePlanLimits, priceInputToCents } from '../../utils/platformPlanForm'
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

  it('convierte el almacenamiento capturado en GB a bytes', () => {
    expect(gbToBytes('1')).toBe(1073741824)
    expect(gbToBytes('0.5')).toBe(536870912)
    expect(gbToBytes('')).toBeNull()
    expect(gbToBytes(null)).toBeNull()
  })

  it('muestra los bytes almacenados como GB sin ruido de decimales', () => {
    expect(bytesToGb(1073741824)).toBe(1)
    expect(bytesToGb(536870912)).toBe(0.5)
    expect(bytesToGb(null)).toBeNull()
    expect(bytesToGb(gbToBytes('0.1'))).toBe(0.1)
  })

  it('guarda el límite de almacenamiento del plan en bytes a partir de GB', () => {
    const limits = normalizePlanLimits({ storageBytes: '2', users: '15', sites: '' })
    expect(limits.storageBytes).toBe(2147483648)
    expect(limits.users).toBe(15)
    expect(limits.sites).toBeNull()
    expect(normalizePlanLimits({ storageBytes: '' }).storageBytes).toBeNull()
  })

  it('convierte la excepción de almacenamiento a bytes sin afectar otros conceptos', () => {
    expect(normalizeOverrideValue('1.5', false, 'storageBytes')).toBe(1610612736)
    expect(normalizeOverrideValue('', false, 'storageBytes')).toBeNull()
    expect(normalizeOverrideValue('2', true, 'storageBytes')).toBeNull()
    expect(normalizeOverrideValue('15', false, 'users')).toBe(15)
  })
})
