import { describe, it, expect } from 'vitest'
import { computeBackoffMs, resolveStatus, MAX_ATTEMPTS } from '../../server/utils/triggerActions'

// HU-ERD-49: cubre las dos funciones puras del ejecutor de acciones (sin
// Postgres ni red) - mismo criterio que triggerConditions.test.ts (ERD-48).

describe('computeBackoffMs', () => {
  it('crece exponencialmente en minutos (2^intento)', () => {
    expect(computeBackoffMs(1)).toBe(2 * 60_000)
    expect(computeBackoffMs(2)).toBe(4 * 60_000)
    expect(computeBackoffMs(3)).toBe(8 * 60_000)
    expect(computeBackoffMs(4)).toBe(16 * 60_000)
  })
})

describe('resolveStatus', () => {
  it('sin ningun fallo -> success, sin importar attemptCount', () => {
    expect(resolveStatus(false, false, 1)).toBe('success')
    expect(resolveStatus(false, false, 5)).toBe('success')
  })

  it('fallo NO reintentable (config invalida, validacion) -> failed, aunque sea el primer intento', () => {
    expect(resolveStatus(true, false, 1)).toBe('failed')
  })

  it('fallo reintentable con intentos restantes -> retrying', () => {
    expect(resolveStatus(true, true, 1)).toBe('retrying')
    expect(resolveStatus(true, true, MAX_ATTEMPTS - 1)).toBe('retrying')
  })

  it('fallo reintentable al agotar MAX_ATTEMPTS -> dead_letter', () => {
    expect(resolveStatus(true, true, MAX_ATTEMPTS)).toBe('dead_letter')
    expect(resolveStatus(true, true, MAX_ATTEMPTS + 1)).toBe('dead_letter')
  })
})
