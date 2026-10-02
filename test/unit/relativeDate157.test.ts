import { describe, expect, it } from 'vitest'
import { datePresentation, datePreviewDays, formattedFieldDate } from '~/utils/relativeDate'

describe('Formatos Fecha HU-157', () => {
  it.each([
    ['short', '01/10/2026', '01/10/2026 14:30'],
    ['medium', '1 oct 2026', '1 oct 2026, 14:30'],
    ['long', '1 de octubre de 2026', '1 de octubre de 2026, 14:30']
  ] as const)('%s para día civil e instante', (format, day, instant) => {
    for (const zone of ['America/Mexico_City', 'Asia/Tokyo']) expect(formattedFieldDate('2026-10-01', format, zone)).toBe(day)
    expect(formattedFieldDate('2026-10-01T20:30:00Z', format, 'America/Mexico_City')).toBe(instant)
    expect(formattedFieldDate('2026-10-01T05:30:00Z', format, 'Asia/Tokyo')).toBe(instant)
  })
  it('instantes cruzan medianoche según zona; 00 usa reloj de 24 horas', () => {
    expect(formattedFieldDate('2026-10-02T05:59:00Z', 'short')).toBe('01/10/2026 23:59')
    expect(formattedFieldDate('2026-10-02T06:00:00Z', 'short')).toBe('02/10/2026 00:00')
    expect(formattedFieldDate('2026-10-02T06:00:00Z', 'medium', 'Asia/Tokyo')).toBe('2 oct 2026, 15:00')
  })
  it.each(['', 'no-fecha', '2026-02-30', '2026-13-01', '2026-02-30T14:30:00Z', '2026-10-01T25:30:00Z'])('maneja inválido %s', value => {
    for (const format of ['short', 'medium', 'long'] as const) expect(formattedFieldDate(value, format)).toBe('Fecha inválida')
  })
  it.each([['absolute', false], ['both', true], ['relative', true]] as const)('lectura compatible %s, sin mutación', (display, showRelative) => {
    const rules = { display }
    expect(datePresentation(rules)).toEqual({ dateFormat: 'short', showRelative })
    expect(rules).toEqual({ display })
    expect(datePresentation({ ...rules, dateFormat: 'long', showRelative: false })).toEqual({ dateFormat: 'long', showRelative: false })
  })
  it('defaults tolerantes y ejemplos por día civil', () => {
    expect(datePresentation()).toEqual({ dateFormat: 'short', showRelative: false })
    expect(datePresentation({ dateFormat: 'otro', display: 'otro' })).toEqual(datePresentation())
    expect(datePreviewDays(new Date('2026-10-02T05:59:00Z'), 'America/Mexico_City')).toEqual({ today: '2026-10-01', past: '2026-09-19', future: '2026-10-31' })
    expect(datePreviewDays(new Date('2026-10-02T05:59:00Z'), 'Asia/Tokyo').today).toBe('2026-10-02')
  })
})
