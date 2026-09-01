import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkLoginRateLimit, recordFailedLoginAttempt, clearLoginRateLimit, resetAllRateLimits } from '../../server/utils/rateLimit'

// HU-ERD-83 (parte 1): rateLimit.ts es logica pura en memoria (sin DB ni
// servidor) - unit test con fake timers, mismo criterio que appConfig.test.ts
// (HU-ERD-35) para no pagar el costo de una ventana real de 15 minutos.

const KEY = 'tenant-a:user@test.com'

beforeEach(() => {
  resetAllRateLimits()
  vi.useRealTimers()
})

describe('rateLimit (login)', () => {
  it('no bloquea con menos de 5 intentos fallidos', () => {
    for (let i = 0; i < 4; i++) recordFailedLoginAttempt(KEY)
    expect(checkLoginRateLimit(KEY)).toEqual({ blocked: false, retryAfterSeconds: 0 })
  })

  it('bloquea al 5to intento fallido dentro de la ventana', () => {
    for (let i = 0; i < 5; i++) recordFailedLoginAttempt(KEY)
    const status = checkLoginRateLimit(KEY)
    expect(status.blocked).toBe(true)
    expect(status.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('claves distintas (otro tenant/email) no se contaminan entre si', () => {
    for (let i = 0; i < 5; i++) recordFailedLoginAttempt(KEY)
    expect(checkLoginRateLimit(KEY).blocked).toBe(true)
    expect(checkLoginRateLimit('tenant-b:otro@test.com').blocked).toBe(false)
  })

  it('clearLoginRateLimit (login exitoso) desbloquea de inmediato', () => {
    for (let i = 0; i < 5; i++) recordFailedLoginAttempt(KEY)
    expect(checkLoginRateLimit(KEY).blocked).toBe(true)
    clearLoginRateLimit(KEY)
    expect(checkLoginRateLimit(KEY).blocked).toBe(false)
  })

  it('los intentos fuera de la ventana (15 min) prescriben y dejan de contar', () => {
    vi.useFakeTimers()
    try {
      const start = new Date('2026-01-01T00:00:00Z')
      vi.setSystemTime(start)
      for (let i = 0; i < 5; i++) recordFailedLoginAttempt(KEY)
      expect(checkLoginRateLimit(KEY).blocked).toBe(true)

      vi.setSystemTime(new Date(start.getTime() + 16 * 60 * 1000))
      expect(checkLoginRateLimit(KEY).blocked).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
