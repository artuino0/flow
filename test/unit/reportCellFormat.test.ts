import { describe, expect, it } from 'vitest'
import { formatReportCell } from '../../utils/reportCellFormat'

describe('formatReportCell', () => {
  it('formatea fechas ISO sin mostrar la hora ni cambiar el día por zona horaria', () => {
    expect(formatReportCell('2026-08-24T00:00:00.000Z', 'date')).toBe('24/08/2026')
    expect(formatReportCell('2026-08-25', 'date')).toBe('25/08/2026')
  })

  it('conserva moneda y centavos configurados', () => {
    expect(formatReportCell('5060.00', 'currency', false, 'MXN', 2)).toContain('5,060.00')
    expect(formatReportCell('8.2', 'currency', false, 'USD', 2)).toContain('8.20')
  })
})
