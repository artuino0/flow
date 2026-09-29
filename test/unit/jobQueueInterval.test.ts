import { describe, expect, it } from 'vitest'
import { jobQueueIntervalSeconds } from '../../server/utils/jobQueueInterval'

describe('intervalo de la cola', () => {
  it('usa 10 s en desarrollo y 60 s en producción', () => {
    expect(jobQueueIntervalSeconds('development')).toBe(10)
    expect(jobQueueIntervalSeconds('production')).toBe(60)
  })

  it('acepta una variable positiva y descarta valores inválidos', () => {
    expect(jobQueueIntervalSeconds('production', '15')).toBe(15)
    expect(jobQueueIntervalSeconds('development', '0')).toBe(10)
    expect(jobQueueIntervalSeconds('production', '1.5')).toBe(60)
  })
})
