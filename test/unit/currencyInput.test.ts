import { describe, expect, it } from 'vitest'
import { formatCentsToCurrency, formatCurrencyDraft, parseCurrencyToCents } from '../../utils/currencyInput'

describe('entrada de moneda', () => {
  it('convierte el texto capturado a centavos', () => {
    expect(parseCurrencyToCents('1299')).toBe(129900)
    expect(parseCurrencyToCents('1,299.5')).toBe(129950)
    expect(parseCurrencyToCents('$1,299.50')).toBe(129950)
    expect(parseCurrencyToCents('')).toBeNull()
    expect(parseCurrencyToCents('12abc')).toBeNull()
    expect(parseCurrencyToCents('-5')).toBeNull()
  })

  it('formatea los centavos como moneda MXN', () => {
    expect(formatCentsToCurrency(129900)).toBe('$1,299.00')
    expect(formatCentsToCurrency(129950)).toBe('$1,299.50')
    expect(formatCentsToCurrency(0)).toBe('$0.00')
  })

  it('agrupa miles mientras se escribe conservando los decimales tecleados', () => {
    expect(formatCurrencyDraft('1299.5')).toBe('$1,299.5')
    expect(formatCurrencyDraft('1299.')).toBe('$1,299.')
    expect(formatCurrencyDraft('')).toBe('')
    expect(formatCurrencyDraft('12a99')).toBe('$1,299')
    expect(formatCurrencyDraft('$1,299.50')).toBe('$1,299.50')
    expect(formatCurrencyDraft('1299.567')).toBe('$1,299.56')
  })
})
