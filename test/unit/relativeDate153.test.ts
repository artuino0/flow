import { describe, expect, it } from 'vitest'
import { exactFieldDate, relativeDate } from '~/utils/relativeDate'
const now = new Date('2026-10-01T18:00:00Z')
function date(days: number) { return new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10) }
describe('Fecha relativa es-MX por día civil', () => {
  it.each([
    [0, 'hoy'], [-1, 'ayer'], [1, 'mañana'], [-12, 'hace 12 días'], [12, 'dentro de 12 días'],
    [7, 'en una semana'], [-7, 'hace 7 días'], [13, 'dentro de 13 días'], [-13, 'hace 13 días'],
    [14, 'en 2 semanas'], [-14, 'hace 2 semanas'], [27, 'en 4 semanas'], [-27, 'hace 4 semanas'],
    [28, 'en 1 mes'], [-28, 'hace 1 mes'], [31, 'en 1 mes'], [-31, 'hace 1 mes'],
    [60, 'en 2 meses'], [-60, 'hace 2 meses'], [364, 'en 12 meses'], [-364, 'hace 12 meses'],
    [365, 'en 1 año'], [-365, 'hace 1 año'], [730, 'en 2 años'], [-730, 'hace 2 años']
  ])('%i días: %s', (days, text) => { expect(relativeDate(date(Number(days)), now)).toBe(text) })
  it('sin hora conserva el día; un instante usa la zona de la organización', () => {
    const midnight = new Date('2026-10-02T05:59:59Z')
    expect(relativeDate('2026-10-02', midnight, 'America/Mexico_City')).toBe('mañana')
    expect(relativeDate('2026-10-02T00:00:00Z', midnight, 'America/Mexico_City')).toBe('hoy')
    expect(relativeDate('2026-10-02', new Date('2026-10-02T06:00:00Z'), 'America/Mexico_City')).toBe('hoy')
    expect(relativeDate('2026-10-02T00:00:00Z', midnight, 'Asia/Tokyo')).toBe('hoy')
    expect(relativeDate('2026-10-01', midnight, 'Asia/Tokyo')).toBe('ayer')
  })
  it('fechas imposibles o vacías se manejan sin excepción y la exacta mantiene el día', () => {
    expect(relativeDate('2026-02-30', now)).toBe('Fecha inválida')
    expect(relativeDate('', now)).toBe('Fecha inválida')
    expect(exactFieldDate('2026-10-02', 'America/Mexico_City')).toContain('2 oct')
    expect(exactFieldDate('2026-10-02T00:00:00Z', 'America/Mexico_City')).toContain('1 oct')
  })
})
