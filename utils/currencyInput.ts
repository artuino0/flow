const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

export function parseCurrencyToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

export function formatCentsToCurrency(cents: number): string {
  return currencyFormatter.format(cents / 100)
}

export function formatCurrencyDraft(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (cleaned === '') return ''
  const dotIndex = cleaned.indexOf('.')
  const intPart = dotIndex === -1 ? cleaned : cleaned.slice(0, dotIndex)
  const decPart = dotIndex === -1 ? null : cleaned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)
  return `$${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decPart === null ? '' : `.${decPart}`}`
}
