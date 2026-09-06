import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../../utils/relativeTime'

// ERD-88: prueba pura (sin Postgres, sin red) - mismo criterio que
// test/unit/pluralize.test.ts para utils/ compartidas entre server y cliente.

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-06T12:00:00.000Z')

  it('menos de un minuto', () => {
    expect(formatRelativeTime('2026-09-06T11:59:40.000Z', now)).toBe('hace un momento')
  })

  it('minutos, singular y plural', () => {
    expect(formatRelativeTime('2026-09-06T11:59:00.000Z', now)).toBe('hace 1 minuto')
    expect(formatRelativeTime('2026-09-06T11:55:00.000Z', now)).toBe('hace 5 minutos')
  })

  it('horas', () => {
    expect(formatRelativeTime('2026-09-06T09:00:00.000Z', now)).toBe('hace 3 horas')
  })

  it('días (ej. mock real: "Editado hace 2 días")', () => {
    expect(formatRelativeTime('2026-09-04T12:00:00.000Z', now)).toBe('hace 2 días')
  })

  it('semanas (ej. mock real: "Editado hace 1 semana")', () => {
    expect(formatRelativeTime('2026-08-30T12:00:00.000Z', now)).toBe('hace 1 semana')
  })

  it('meses', () => {
    expect(formatRelativeTime('2026-07-01T12:00:00.000Z', now)).toBe('hace 2 meses')
  })

  it('años', () => {
    expect(formatRelativeTime('2024-09-06T12:00:00.000Z', now)).toBe('hace 2 años')
  })

  it('nunca da un numero negativo si la fecha viene levemente en el futuro (clock skew)', () => {
    expect(formatRelativeTime('2026-09-06T12:00:05.000Z', now)).toBe('hace un momento')
  })
})
