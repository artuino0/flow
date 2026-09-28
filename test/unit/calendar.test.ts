import { describe, expect, it } from 'vitest'
import { calendarBlockPosition, calendarRange, localDateTimeToIso, minutesFromTime, zonedTimeFromIso } from '../../utils/calendar'

describe('calendar ranges and event layout', () => {
  it('calcula rangos de día, semana ISO y mes con límite superior exclusivo', () => {
    const anchor = new Date(2025, 8, 17, 12)
    expect(calendarRange(anchor, 'day')).toEqual({ from: '2025-09-17', to: '2025-09-18' })
    expect(calendarRange(anchor, 'week')).toEqual({ from: '2025-09-15', to: '2025-09-22' })
    expect(calendarRange(anchor, 'month')).toEqual({ from: '2025-09-01', to: '2025-10-01' })
  })

  it('ubica los bloques a partir de su hora y les asigna altura según duración', () => {
    expect(minutesFromTime('09:30')).toBe(570)
    expect(calendarBlockPosition('09:30', 90)).toEqual({ top: 160, height: 96 })
    expect(calendarBlockPosition('06:00', 5)).toEqual({ top: 0, height: 24 })
  })

  it('convierte horas usando la zona horaria configurada por el tenant', () => {
    expect(zonedTimeFromIso('2025-01-15T15:00:00.000Z', 'America/Mexico_City')).toBe('09:00')
    expect(localDateTimeToIso('2025-01-15', '09:00', 'America/Mexico_City')).toBe('2025-01-15T15:00:00.000Z')
  })
})
