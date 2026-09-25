import { afterEach, describe, expect, it } from 'vitest'
import { formatDate } from '../../utils/fieldValueFormat'

const originalTimezone = process.env.TZ

afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimezone
})

describe('formatDate', () => {
  it('formatea instantes en la zona fija de Ciudad de México aunque cambie la zona del proceso', () => {
    process.env.TZ = 'America/Los_Angeles'
    const losAngeles = formatDate('2026-09-25T02:30:00Z')

    process.env.TZ = 'Pacific/Kiritimati'
    expect(formatDate('2026-09-25T02:30:00Z')).toBe(losAngeles)
    expect(losAngeles).toBe('24/9/2026')
  })

  it('mantiene la fecha pura en el límite del día', () => {
    process.env.TZ = 'America/Los_Angeles'
    expect(formatDate('2026-09-24')).toBe('24/9/2026')
    process.env.TZ = 'Pacific/Kiritimati'
    expect(formatDate('2026-09-24')).toBe('24/9/2026')
  })
})
