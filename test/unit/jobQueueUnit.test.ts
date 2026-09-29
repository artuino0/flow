import { describe, it, expect } from 'vitest'
import { computeRetryDelayMs, createRateLimiter } from '../../server/utils/jobQueue'
import { classifyEmailError } from '../../server/utils/jobHandlers'
import { SmtpNotConfiguredError } from '../../server/utils/mailer'

describe('computeRetryDelayMs', () => {
  it('sube por escalones: 1 min, 5 min, 15 min, 1 h, 6 h y se queda en 6 h', () => {
    const at = (attempts: number) => computeRetryDelayMs(attempts, () => 0.5)
    expect([1, 2, 3, 4, 5, 6, 20].map(at)).toEqual([60_000, 300_000, 900_000, 3_600_000, 21_600_000, 21_600_000, 21_600_000])
  })
  it('varía ±10% para que los reintentos no golpeen a la vez', () => {
    expect(computeRetryDelayMs(1, () => 0)).toBe(54_000)
    expect(computeRetryDelayMs(1, () => 1)).toBe(66_000)
  })
})

describe('createRateLimiter', () => {
  it('espacia las salidas al ritmo pedido', async () => {
    let clock = 0
    const waits: number[] = []
    const take = createRateLimiter(10, () => clock, async (ms) => { waits.push(ms); clock += ms })
    for (let i = 0; i < 4; i++) await take()
    expect(waits).toEqual([100, 100, 100]) // la primera sale de inmediato
  })
  it('no acumula "crédito" si pasó tiempo sin enviar', async () => {
    let clock = 0
    const waits: number[] = []
    const take = createRateLimiter(10, () => clock, async (ms) => { waits.push(ms); clock += ms })
    await take()
    clock += 10_000
    await take()
    await take()
    expect(waits).toEqual([100])
  })
  it('sin límite (0) nunca espera', async () => {
    const waits: number[] = []
    const take = createRateLimiter(0, () => 0, async (ms) => { waits.push(ms) })
    await take(); await take()
    expect(waits).toEqual([])
  })
})

describe('classifyEmailError', () => {
  it('no reintenta configuración faltante, credenciales rechazadas ni 5xx', () => {
    expect(classifyEmailError(new SmtpNotConfiguredError('falta SMTP'))).toMatchObject({ ok: false, retryable: false })
    expect(classifyEmailError(Object.assign(new Error('bad login'), { code: 'EAUTH' }))).toMatchObject({ retryable: false })
    expect(classifyEmailError(Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }))).toMatchObject({ retryable: false })
  })
  it('reintenta errores de red, tiempos de espera y 4xx', () => {
    expect(classifyEmailError(new Error('Connection timeout'))).toMatchObject({ retryable: true })
    expect(classifyEmailError(Object.assign(new Error('rate exceeded'), { responseCode: 454 }))).toMatchObject({ retryable: true })
    expect(classifyEmailError('cadena rara')).toMatchObject({ retryable: true, error: 'cadena rara' })
    expect(classifyEmailError(Object.assign(new Error('550 5.7.0 Too many emails per second'), { responseCode: 550 }))).toMatchObject({ retryable: true })
  })
})
