import { z } from 'zod'

export const agendaSettingsSchema = z.object({
  slotMinutes: z.number().int().min(5).max(120).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeMinutes: z.number().int().min(0).max(525600).default(0),
  maxDaysAhead: z.number().int().min(1).max(365).default(30),
  assignmentMode: z.enum(['client_chooses', 'auto', 'both']).default('both'),
  conflictPolicy: z.enum(['block', 'warn']).default('block'),
  confirmationMessage: z.string().trim().max(2000).default('Tu cita quedó agendada.')
}).strict()
export type AgendaSettings = z.infer<typeof agendaSettingsSchema>
export const agendaDefaults = agendaSettingsSchema.parse({})
export const agendaDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Fecha inválida')
export const agendaTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
export const scheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6), startTime: agendaTime, endTime: agendaTime,
  validFrom: agendaDate.nullable().default(null), validTo: agendaDate.nullable().default(null)
}).strict().refine(row => row.startTime < row.endTime, 'El inicio debe ser anterior al fin')
  .refine(row => !row.validFrom || !row.validTo || row.validFrom <= row.validTo, 'Vigencia inválida')
export type AgendaSchedule = z.infer<typeof scheduleSchema> & { userId?: string }
export const schedulesSchema = z.array(scheduleSchema).max(100).superRefine((rows, ctx) => {
  rows.forEach((a, i) => rows.slice(i + 1).forEach(b => {
    if (a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime
      && (a.validFrom ?? '0001-01-01') <= (b.validTo ?? '9999-12-31') && (b.validFrom ?? '0001-01-01') <= (a.validTo ?? '9999-12-31'))
      ctx.addIssue({ code: 'custom', message: 'Los rangos del mismo día no pueden traslaparse' })
  }))
})
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/).refine(v => agendaDate.safeParse(v.slice(0, 10)).success)
export const timeOffSchema = z.object({ userId: z.string().uuid().nullable(), startLocal: localDateTime, endLocal: localDateTime,
  reason: z.string().trim().min(1).max(500), allDay: z.boolean().default(false)
}).strict().refine(v => v.startLocal < v.endLocal, 'El inicio debe ser anterior al fin')
  .refine(v => !v.allDay || (v.startLocal.endsWith('T00:00') && v.endLocal.endsWith('T00:00')), 'Un bloqueo de todo el día termina a medianoche del día siguiente')
export type AgendaTimeOff = z.infer<typeof timeOffSchema>
export interface AgendaSlot { userId: string; date: string; time: string; start: string; end: string; status: 'free' }
export interface AgendaPerson { id: string; name: string }
export interface AgendaAppointment { userId: string; date: string; time: string; duration: number; state: string }
export function agendaErrorMessage(error: unknown) {
  const value = error as { data?: { statusMessage?: string }; message?: string }
  return value?.data?.statusMessage || value?.message || 'No se pudo completar la operación.'
}
