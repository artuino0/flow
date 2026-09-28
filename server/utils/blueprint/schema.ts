import { z } from 'zod'
import { KNOWN_DATA_TYPES, getValidationRulesSchema } from '~/server/utils/dynamicSchema'
import { detailLayoutSchema } from '~/server/utils/detailLayout'
import { stateWorkflowSchema } from '~/server/utils/stateWorkflow'
import type { CalculationConfig } from '~/server/utils/calculatedFields'

export const blueprintFieldSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
  dataType: z.enum(KNOWN_DATA_TYPES),
  required: z.boolean().optional(),
  isOwnerField: z.boolean().optional(),
  validationRules: z.record(z.unknown()).optional()
}).strict().superRefine((field, ctx) => {
  const result = getValidationRulesSchema(field.dataType)?.safeParse(field.validationRules ?? {})
  if (field.isOwnerField && field.dataType !== 'user') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['isOwnerField'], message: 'Responsable requiere tipo Usuario' })
  if (result && !result.success) for (const issue of result.error.issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validationRules', ...issue.path], message: issue.message })
  }
})

export const blueprintLinesSchema = z.object({
  childRef: z.string().trim().min(1),
  relationField: z.string().trim().min(1),
  totals: z.array(z.string().trim().min(1)).max(10).optional()
}).strict()

export const blueprintModuleSchema = z.object({
  ref: z.string().trim().min(1),
  action: z.enum(['create', 'extend']),
  kind: z.enum(['hecho', 'dimension']),
  name: z.string().trim().min(1),
  singularName: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(blueprintFieldSchema),
  lines: z.array(blueprintLinesSchema).optional(),
  workflow: stateWorkflowSchema.optional(),
  // Una exportación contiene los campos actuales para dibujar el lienzo.
  // El validador exige que permanezcan idénticos y solo aplica los nuevos.
  snapshot: z.boolean().optional(),
  detailLayout: detailLayoutSchema.optional()
}).strict()

export const blueprintSchema = z.object({
  version: z.literal(1),
  summary: z.string().trim().min(1),
  modules: z.array(blueprintModuleSchema),
  associations: z.array(z.object({ name: z.string().trim().min(1), sourceRef: z.string().trim().min(1), targetRef: z.string().trim().min(1) }).strict()),
  roles: z.array(z.object({
    name: z.string().trim().min(1),
    permissions: z.array(z.object({
      moduleRef: z.string().trim().min(1),
      visibility: z.enum(['all', 'own']),
      canRead: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean()
    }).strict())
  }).strict()).optional()
}).strict()

export type Blueprint = z.infer<typeof blueprintSchema>
export type BlueprintModule = Blueprint['modules'][number]
export type BlueprintField = BlueprintModule['fields'][number]
export type BlueprintCalculation = CalculationConfig
