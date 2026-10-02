import { z } from 'zod'
const TABLE_COLUMN_TYPES = ['text', 'number', 'boolean', 'date', 'relation'] as const

export const tableColumnSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(TABLE_COLUMN_TYPES),
    // Solo tiene sentido si type === 'relation' - no se fuerza con una union
    // discriminada para no complicar el mensaje de error; queda documentado aca.
    relationEntity: z.string().min(1).optional(),
    // "copiar de <entidad>.<campo> al elegir la fila, una sola vez" (snapshot,
    // ver DOCS/Diseno_Pantallas_Faltantes_Fase2.md "Semantica de copia") - solo
    // metadata para el frontend (ERD-71/72), buildFieldType() de abajo no la usa.
    copyFrom: z.string().min(1).optional(),
    editable: z.boolean().optional(),
    readonly: z.boolean().optional()
  })
  .strict()

export const selectOptionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    color: z.string().min(1).optional()
  })
  .strict()

export const calculationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('formula'),
    operator: z.enum(['add', 'subtract', 'multiply', 'divide']),
    leftField: z.string().min(1),
    rightField: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal('rollup'),
    aggregate: z.enum(['sum', 'count', 'avg', 'min', 'max']),
    sourceEntity: z.string().min(1),
    relationField: z.string().min(1),
    valueField: z.string().min(1).optional(),
    filter: z.object({
      field: z.string().min(1),
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
      value: z.string().max(200)
    }).strict().optional()
  }).strict(),
  z.object({
    kind: z.literal('expression'),
    expression: z.string().trim().min(1).max(500)
  }).strict()
]).superRefine((value, ctx) => {
  if (value.kind === 'rollup' && value.aggregate !== 'count' && !value.valueField) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'valueField es obligatorio cuando el acumulado no es un conteo', path: ['valueField'] })
  }
})

