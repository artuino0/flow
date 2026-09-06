// ERD-88 (Diseñador de reportes imprimibles): formato "Editado hace X" del
// listado "REPORTES GUARDADOS" (Screen/Generar reporte - punto de entrada,
// subtitulo de cada item: "Editado hace 2 días", "Editado hace 1 semana").
// Español neutro (sin voseo, mismo criterio del resto de la UI) - no hay
// libreria de fechas relativas en el proyecto todavia, asi que se implementa
// a mano igual que utils/slugify.ts/recordLabel.ts.
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))

  if (diffSeconds < MINUTE) return 'hace un momento'
  if (diffSeconds < HOUR) {
    const n = Math.floor(diffSeconds / MINUTE)
    return `hace ${n} minuto${n === 1 ? '' : 's'}`
  }
  if (diffSeconds < DAY) {
    const n = Math.floor(diffSeconds / HOUR)
    return `hace ${n} hora${n === 1 ? '' : 's'}`
  }
  if (diffSeconds < WEEK) {
    const n = Math.floor(diffSeconds / DAY)
    return `hace ${n} día${n === 1 ? '' : 's'}`
  }
  if (diffSeconds < MONTH) {
    const n = Math.floor(diffSeconds / WEEK)
    return `hace ${n} semana${n === 1 ? '' : 's'}`
  }
  if (diffSeconds < YEAR) {
    const n = Math.floor(diffSeconds / MONTH)
    return `hace ${n} mes${n === 1 ? '' : 'es'}`
  }
  const n = Math.floor(diffSeconds / YEAR)
  return `hace ${n} año${n === 1 ? '' : 's'}`
}
