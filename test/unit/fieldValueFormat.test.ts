import { afterEach, describe, expect, it } from 'vitest'
import { formatDate, formatFieldValue, formatFileSize } from '../../utils/fieldValueFormat'

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

describe('formatFieldValue para archivos', () => {
  it('no presenta el identificador interno en el fallback de texto', () => {
    expect(formatFieldValue({ name: 'adjunto', dataType: 'file' }, '6dfc7bc5-100e-440d-8e3e-734566f91dc0')).toBe('Archivo')
  })

  it('formatea el tamaño del archivo en unidades legibles', () => {
    expect(formatFileSize(920)).toBe('920 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB')
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})
