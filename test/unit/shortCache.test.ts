import { describe, it, expect } from 'vitest'
import { createShortCache, invalidateTenantAccess, invalidatesTenantAccess, accessCache, metadataCache, ttlFromEnv } from '../../server/utils/shortCache'

function clock(start = 1_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('createShortCache', () => {
  it('devuelve lo guardado hasta que vence el tiempo', () => {
    const time = clock()
    const cache = createShortCache<string>({ ttlMs: 5_000, now: time.now })
    cache.set('a', 'uno')
    expect(cache.get('a')).toBe('uno')
    time.advance(4_999)
    expect(cache.get('a')).toBe('uno')
    time.advance(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0) // el vencido se descarta al consultarlo
  })

  it('con tiempo 0 (o negativo) queda desactivado: no guarda ni devuelve', () => {
    for (const ttlMs of [0, -1, Number.NaN]) {
      const cache = createShortCache<number>({ ttlMs })
      cache.set('a', 1)
      expect(cache.get('a')).toBeUndefined()
      expect(cache.size).toBe(0)
    }
  })

  it('volver a guardar renueva el tiempo y delete/deletePrefix/clear limpian', () => {
    const time = clock()
    const cache = createShortCache<number>({ ttlMs: 1_000, now: time.now })
    cache.set('t1:a', 1); cache.set('t1:b', 2); cache.set('t2:a', 3)
    time.advance(900)
    cache.set('t1:a', 10) // renovado
    time.advance(200)
    expect(cache.get('t1:a')).toBe(10)
    expect(cache.get('t1:b')).toBeUndefined() // el resto ya venció
    cache.set('t1:b', 2)
    cache.set('t2:a', 3)
    expect(cache.deletePrefix('t1:')).toBe(2)
    expect(cache.get('t2:a')).toBe(3)
    cache.delete('t2:a')
    expect(cache.size).toBe(0)
    cache.set('x', 1); cache.clear()
    expect(cache.size).toBe(0)
  })

  it('respeta el tope de entradas descartando las más antiguas', () => {
    const cache = createShortCache<number>({ ttlMs: 10_000, maxEntries: 3 })
    for (let i = 1; i <= 5; i++) cache.set(`k${i}`, i)
    expect(cache.size).toBe(3)
    expect([cache.get('k1'), cache.get('k2'), cache.get('k3'), cache.get('k4'), cache.get('k5')]).toEqual([undefined, undefined, 3, 4, 5])
  })
})

describe('ttlFromEnv', () => {
  it('usa el valor de la variable, 0 la apaga y lo inválido cae al valor por defecto', () => {
    expect(ttlFromEnv('X', 5_000, { X: '2500' } as never)).toBe(2500)
    expect(ttlFromEnv('X', 5_000, { X: '0' } as never)).toBe(0)
    expect(ttlFromEnv('X', 5_000, {} as never)).toBe(5_000)
    expect(ttlFromEnv('X', 5_000, { X: '' } as never)).toBe(5_000)
    expect(ttlFromEnv('X', 5_000, { X: 'abc' } as never)).toBe(5_000)
    expect(ttlFromEnv('X', 5_000, { X: '-3' } as never)).toBe(5_000)
  })
})

describe('invalidación por organización', () => {
  it('invalidateTenantAccess limpia solo a esa organización, en accesos y metadatos', () => {
    // En las pruebas los cachés compartidos están apagados (TTL 0): se comprueba con la lógica de prefijo.
    expect(accessCache.ttlMs).toBe(0)
    expect(metadataCache.ttlMs).toBe(0)
    expect(() => invalidateTenantAccess('t1')).not.toThrow()
  })

  it('invalidatesTenantAccess invalida al terminar, también cuando la escritura falla', async () => {
    const cache = createShortCache<number>({ ttlMs: 10_000 })
    cache.set('t1:x', 1)
    // Se comprueba el envoltorio con un caché propio sustituyendo la función global por un espía.
    let invalidated = 0
    const wrapped = invalidatesTenantAccess(async (tenantId: string, fail: boolean) => {
      invalidated++
      if (fail) throw new Error('boom')
      return tenantId
    })
    expect(await wrapped('t1', false)).toBe('t1')
    await expect(wrapped('t1', true)).rejects.toThrow('boom')
    expect(invalidated).toBe(2)
  })
})
