import type { AgendaAppointment, AgendaPerson, AgendaSchedule, AgendaSettings, AgendaSlot, AgendaTimeOff } from '~/utils/agenda'

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(zone: string) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  return formatters.get(zone)!
}
export function localAt(instant: number, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(instant).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
// Se prueban los offsets de ambos lados del cambio. La hora repetida usa el
// primer instante; la inexistente devuelve null y jamás aparece en la rejilla.
export function localInstant(local: string, zone: string): number | null {
  const wall = Date.parse(local + ':00Z')
  const offsets = new Set<number>()
  for (const delta of [-36, -12, 0, 12, 36]) {
    const probe = wall + delta * 3600000
    offsets.add(Date.parse(localAt(probe, zone) + ':00Z') - probe)
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(instant => localAt(instant, zone) === local)
  return candidates.length ? Math.min(...candidates) : null
}
export function addAgendaDays(date: string, days: number) { return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10) }
export function timeMinutes(time: string) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) }
function minuteTime(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
export function appointmentInterval(cita: AgendaAppointment, zone: string) {
  const start = localInstant(`${cita.date}T${cita.time}`, zone)
  return start === null ? null : { start, end: start + cita.duration * 60000 }
}
export function occupies(state: string) { return !['cancelada', 'no_asistio'].includes(state) }
export interface AvailabilityInput {
  settings: AgendaSettings; timezone: string; people: AgendaPerson[]; schedules: AgendaSchedule[];
  timeOff: AgendaTimeOff[]; appointments: AgendaAppointment[]; from: string; to: string; duration: number; now: number
}
export function calculateAvailability(input: AvailabilityInput) {
  const { settings, timezone, now } = input
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 1440) throw new Error('Duración inválida')
  const today = localAt(now, timezone).slice(0, 10), lastDay = addAgendaDays(today, settings.maxDaysAhead)
  const slots: AgendaSlot[] = []
  const from = input.from > today ? input.from : today, to = input.to < lastDay ? input.to : lastDay
  if (input.from > input.to || Date.parse(input.to) - Date.parse(input.from) > 365 * 86400000) throw new Error('Ventana inválida')
  for (let date = from; date <= to; date = addAgendaDays(date, 1)) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
    for (const person of input.people) {
      const busy = input.appointments.filter(cita => cita.userId === person.id && occupies(cita.state)).flatMap(cita => {
        const interval = appointmentInterval(cita, timezone)
        return interval ? [{ start: interval.start - settings.bufferMinutes * 60000, end: interval.end + settings.bufferMinutes * 60000 }] : []
      })
      const blocked = input.timeOff.filter(off => !off.userId || off.userId === person.id).map(off => {
        // Las ausencias cubren también la segunda ocurrencia de una hora repetida.
        const start = localInstant(off.startLocal, timezone), firstEnd = localInstant(off.endLocal, timezone)
        let end = firstEnd
        if (firstEnd !== null) for (let delta = 1; delta <= 180; delta++) if (localAt(firstEnd + delta * 60000, timezone) === off.endLocal) end = firstEnd + delta * 60000
        return { start, end, startLocal: off.startLocal, endLocal: off.endLocal }
      })
      for (const range of input.schedules.filter(row => row.userId === person.id && row.weekday === weekday && (!row.validFrom || row.validFrom <= date) && (!row.validTo || row.validTo >= date))) {
        const rangeEnd = localInstant(`${date}T${range.endTime}`, timezone)
        for (let minute = timeMinutes(range.startTime); minute + input.duration <= timeMinutes(range.endTime); minute += settings.slotMinutes) {
          const time = minuteTime(minute), startLocal = `${date}T${time}`, start = localInstant(startLocal, timezone)
          if (start === null || start < now + settings.minNoticeMinutes * 60000) continue
          const end = start + input.duration * 60000, endLocal = localAt(end, timezone)
          // Fin local y fin absoluto deben caber en el mismo rango, incluso en DST.
          if ((rangeEnd !== null && end > rangeEnd) || endLocal.slice(0, 10) !== date || endLocal.slice(11) > range.endTime) continue
          if (busy.some(b => start < b.end && end > b.start)) continue
          if (blocked.some(b => b.start !== null && b.end !== null ? start < b.end && end > b.start : startLocal < b.endLocal && endLocal > b.startLocal)) continue
          slots.push({ userId: person.id, date, time, start: new Date(start).toISOString(), end: new Date(end).toISOString(), status: 'free' })
        }
      }
    }
  }
  const unique = [...new Map(slots.map(slot => [`${slot.userId}:${slot.start}`, slot])).values()].sort((a, b) => a.start.localeCompare(b.start) || a.userId.localeCompare(b.userId))
  const automatic = [...new Set(unique.map(slot => slot.start))].map(start => {
    const candidates = unique.filter(slot => slot.start === start)
    const count = (slot: AgendaSlot) => input.appointments.filter(cita => cita.userId === slot.userId && cita.date === slot.date && occupies(cita.state)).length
    return candidates.sort((a, b) => count(a) - count(b) || (input.people.find(p => p.id === a.userId)!.name.localeCompare(input.people.find(p => p.id === b.userId)!.name, 'es')) || a.userId.localeCompare(b.userId))[0]!
  })
  return { slots: settings.assignmentMode === 'auto' ? [] : unique, automatic: settings.assignmentMode === 'client_chooses' ? [] : automatic }
}
