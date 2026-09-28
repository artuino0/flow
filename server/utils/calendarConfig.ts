import { z } from 'zod'

export interface CalendarConfig {
  enabled: boolean
  startDateField: string | null
  startTimeField: string | null
  durationField: string | null
  endField: string | null
  titleField: string | null
  colorField: string | null
  groupByField: string | null
  defaultView: 'day' | 'week' | 'month'
}

export const calendarConfigSchema = z.object({
  enabled: z.boolean(),
  startDateField: z.string().min(1).nullable(),
  startTimeField: z.string().min(1).nullable(),
  durationField: z.string().min(1).nullable(),
  endField: z.string().min(1).nullable(),
  titleField: z.string().min(1).nullable(),
  colorField: z.string().min(1).nullable(),
  groupByField: z.string().min(1).nullable(),
  defaultView: z.enum(['day', 'week', 'month'])
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.startDateField) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDateField'], message: 'El calendario necesita un campo de fecha' })
  if (value.durationField && value.endField) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endField'], message: 'Configura duración o campo de fin, no ambos' })
})

export const EMPTY_CALENDAR_CONFIG: CalendarConfig = {
  enabled: false,
  startDateField: null,
  startTimeField: null,
  durationField: null,
  endField: null,
  titleField: null,
  colorField: null,
  groupByField: null,
  defaultView: 'month'
}

interface CalendarField { name: string; dataType: string }

export function resolveCalendarConfig(saved: unknown, fields: CalendarField[]): CalendarConfig {
  const parsed = saved ? calendarConfigSchema.safeParse(saved) : null
  if (!parsed?.success) return { ...EMPTY_CALENDAR_CONFIG }
  const byName = new Map(fields.map(field => [field.name, field]))
  const get = (name: string | null) => name ? byName.get(name) : undefined
  const startDate = get(parsed.data.startDateField)
  const startTime = get(parsed.data.startTimeField)
  const duration = get(parsed.data.durationField)
  const end = get(parsed.data.endField)
  const color = get(parsed.data.colorField)
  const group = get(parsed.data.groupByField)
  const startDateField = startDate?.dataType === 'date' ? startDate.name : null
  const startTimeField = startTime && ['text', 'datetime'].includes(startTime.dataType) ? startTime.name : null
  const durationField = duration?.dataType === 'number' ? duration.name : null
  const endField = end && ['datetime', 'text'].includes(end.dataType) ? end.name : null
  const colorField = color?.dataType === 'select' ? color.name : null
  const groupByField = group && ['user', 'relation', 'select'].includes(group.dataType) ? group.name : null
  const enabled = parsed.data.enabled && Boolean(startDateField)
  return {
    enabled,
    startDateField,
    startTimeField,
    durationField: endField ? null : durationField,
    endField: durationField ? null : endField,
    titleField: get(parsed.data.titleField)?.name ?? null,
    colorField,
    groupByField,
    defaultView: enabled ? parsed.data.defaultView : 'month'
  }
}
