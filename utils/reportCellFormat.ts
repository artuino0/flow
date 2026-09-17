const totalNumber = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const detailNumber = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })

export function formatReportCell(value: unknown, dataType?: string, aggregate = false, currency = 'MXN', decimals = 2): string {
  if (value == null || value === '') return '—'
  if (dataType === 'boolean') return value === true || value === 'true' ? 'Sí' : 'No'
  if (dataType === 'currency' && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value))
  }
  if (typeof value === 'number' || (dataType === 'number' && Number.isFinite(Number(value)))) {
    return (aggregate ? totalNumber : detailNumber).format(Number(value))
  }
  if (dataType === 'date' && typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value)
    if (match) return `${match[3]}/${match[2]}/${match[1]}`
  }
  return String(value)
}
