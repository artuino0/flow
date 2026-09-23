import { z } from 'zod'

export interface BoardConfig {
  enabled: boolean
  statusField: string | null
  titleField: string | null
  secondaryFields: string[]
  defaultView: 'table' | 'board'
}

export const boardConfigSchema = z.object({
  enabled: z.boolean(),
  statusField: z.string().min(1).nullable(),
  titleField: z.string().min(1).nullable(),
  secondaryFields: z.array(z.string().min(1)).max(3),
  defaultView: z.enum(['table', 'board'])
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.statusField) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statusField'], message: 'El tablero necesita un campo de estado' })
  if (value.enabled && !value.titleField) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['titleField'], message: 'El tablero necesita un campo principal' })
})

export const EMPTY_BOARD_CONFIG: BoardConfig = {
  enabled: false,
  statusField: null,
  titleField: null,
  secondaryFields: [],
  defaultView: 'table'
}

interface BoardField { name: string; dataType: string }

export function resolveBoardConfig(saved: unknown, fields: BoardField[]): BoardConfig {
  const parsed = saved ? boardConfigSchema.safeParse(saved) : null
  if (!parsed?.success) return { ...EMPTY_BOARD_CONFIG }
  const known = new Set(fields.map(field => field.name))
  const status = fields.find(field => field.name === parsed.data.statusField)
  const titleField = parsed.data.titleField && known.has(parsed.data.titleField) ? parsed.data.titleField : null
  const enabled = parsed.data.enabled && status?.dataType === 'select' && Boolean(titleField)
  return {
    enabled,
    statusField: status?.dataType === 'select' ? status.name : null,
    titleField,
    secondaryFields: parsed.data.secondaryFields.filter(field => known.has(field) && field !== titleField).slice(0, 3),
    defaultView: enabled ? parsed.data.defaultView : 'table'
  }
}
