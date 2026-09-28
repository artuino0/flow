export type CalendarView = 'day' | 'week' | 'month'

export interface CalendarRange { from: string; to: string }

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calendarRange(anchor: Date, view: CalendarView): CalendarRange {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  if (view === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { from: localDateKey(start), to: localDateKey(end) }
  }
  if (view === 'month') {
    const first = new Date(start.getFullYear(), start.getMonth(), 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
    return { from: localDateKey(first), to: localDateKey(end) }
  }
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: localDateKey(start), to: localDateKey(end) }
}

export function minutesFromTime(value: string | null | undefined): number {
  if (!value) return 9 * 60
  const match = value.match(/(?:T|^)(\d{1,2}):(\d{2})/)
  if (!match) return 9 * 60
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : 9 * 60
}

export function calendarBlockPosition(startTime: string | null | undefined, durationMinutes: number, dayStart = 7, hourHeight = 64) {
  const startMinutes = minutesFromTime(startTime)
  const top = Math.max(0, ((startMinutes - dayStart * 60) / 60) * hourHeight)
  const height = Math.max(24, (Math.max(15, durationMinutes) / 60) * hourHeight)
  return { top, height }
}

export function zonedTimeFromIso(value: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
    const hour = parts.find(part => part.type === 'hour')?.value ?? '00'
    const minute = parts.find(part => part.type === 'minute')?.value ?? '00'
    return `${hour}:${minute}`
  } catch {
    return value.match(/T(\d{2}:\d{2})/)?.[1] ?? ''
  }
}

export function localDateTimeToIso(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const localTimestamp = Date.UTC(year, month - 1, day, hours, minutes)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(new Date(localTimestamp))
  const offset = parts.find(part => part.type === 'timeZoneName')?.value.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!offset) return new Date(localTimestamp).toISOString()
  const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1)
  return new Date(localTimestamp - offsetMinutes * 60_000).toISOString()
}
