/** Días civiles en la zona de la organización, también para instantes con hora.
 * 2–13 días; 14–27 días: semanas; 28–364: meses; desde 365: años.
 * Semanas/meses/años redondean al entero más próximo (mínimo 1).
 * YYYY-MM-DD conserva su día civil; nunca se interpreta como medianoche UTC.
 */
function civilDay(value: string | Date, timezone: string): number {
  let day: string
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) day = value
  else {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) return NaN
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    day = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`
  }
  const timestamp = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day ? timestamp / 86400000 : NaN
}

export function relativeDate(value: string | Date, now: Date, timezone = 'America/Mexico_City'): string {
  const days = civilDay(value, timezone) - civilDay(now, timezone)
  if (!Number.isFinite(days)) return 'Fecha inválida'
  if (days === 0) return 'hoy'
  if (days === -1) return 'ayer'
  if (days === 1) return 'mañana'
  const distance = Math.abs(days)
  if (distance === 7 && days > 0) return 'en una semana'
  if (distance < 14) return days < 0 ? `hace ${distance} días` : `dentro de ${distance} días`
  const unit = distance < 28 ? 'semana' : distance < 365 ? 'mes' : 'año'
  const count = Math.max(1, Math.round(distance / (unit === 'semana' ? 7 : unit === 'mes' ? 30.4375 : 365.25)))
  const plural = count === 1 ? unit : unit === 'mes' ? 'meses' : `${unit}s`
  return `${days < 0 ? 'hace' : 'en'} ${count} ${plural}`
}

export function exactFieldDate(value: string | Date, timezone = 'America/Mexico_City'): string {
  const day = civilDay(value, timezone)
  if (!Number.isFinite(day)) return 'Fecha inválida'
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  return new Intl.DateTimeFormat('es-MX', { timeZone: dateOnly ? 'UTC' : timezone, dateStyle: 'medium', ...(dateOnly ? {} : { timeStyle: 'short' as const }) }).format(dateOnly ? new Date(day * 86400000) : new Date(value))
}
