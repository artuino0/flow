export const CURRENCY_CODES = ['MXN', 'USD', 'EUR', 'CAD', 'GBP', 'BRL', 'ARS', 'COP', 'CLP', 'PEN', 'GTQ'] as const

export function currencyCode(rules: Record<string, unknown> | undefined): string {
  const resolved = rules?.resolvedCurrency
  if (typeof resolved === 'string' && /^[A-Z]{3}$/.test(resolved)) return resolved
  const configured = rules?.currency
  if (typeof configured === 'string' && configured !== 'tenant' && /^[A-Z]{3}$/.test(configured)) return configured
  return 'MXN'
}

export function currencyDecimals(rules: Record<string, unknown> | undefined): number {
  const value = rules?.decimals
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4 ? value : 2
}

export function formatCurrencyValue(value: unknown, rules?: Record<string, unknown>): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  const decimals = currencyDecimals(rules)
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currencyCode(rules),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(amount)
}
