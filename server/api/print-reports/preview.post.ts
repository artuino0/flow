import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { printReportDslSchema } from '~/server/utils/printReport'
import { previewPrintReport } from '~/server/utils/printReports'
import { PrintReportError } from '~/server/utils/printReport'
import { requirePrintReportAccess } from '~/server/utils/printReportAccess'
import { answerSchema, resolveParameterFilters } from '~/utils/reportParameters'
import { readableReportContext } from '~/server/utils/printReportAccess'
import { ReportPathPlanner } from '~/server/utils/reportFieldPath'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'
import { and, eq } from 'drizzle-orm'

// POST /api/print-reports/preview { dsl } (HU-ERD-88) - corre el DSL contra
// los datos VIGENTES sin guardar nada, tanto para "Vista previa impresión"
// del Diseñador (dsl todavía en edición, puede no existir aún como plantilla)
// como para reimprimir una plantilla ya guardada (el frontend le pasa el
// mismo dsl que le devolvió GET /api/print-reports/:id) - ver comentario
// largo sobre por qué nunca se congela un resultado, en server/db/schema.ts
// junto a la definición de `print_reports`.
const bodySchema = z.object({ dsl: printReportDslSchema, answers: answerSchema.optional() })

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const { auth } = await requirePermission(event, body.dsl.baseEntity, 'canRead')

  try {
    await requirePrintReportAccess(event, body.dsl)
    let filters
    try { filters = resolveParameterFilters(body.dsl.parameters ?? [], body.answers ?? {}) }
    catch (error) { throw createError({ statusCode: 400, statusMessage: (error as Error).message }) }
    const result = await previewPrintReport(auth.tenantId, { ...body.dsl, filters: [...(body.dsl.filters ?? []), ...filters] })
    const ctx = await readableReportContext(event)
    const planner = new ReportPathPlanner(ctx, auth.tenantId, ctx.entitiesBySlug.get(body.dsl.baseEntity)!.id, body.dsl.detail ? ctx.entitiesBySlug.get(body.dsl.detail.entitySlug)!.id : undefined)
    // Resuelve un valor crudo (de un filtro fijo del Diseñador o de la
    // respuesta a un parámetro) a texto legible - registro relacionado,
    // opción de un select, o Sí/No de un booleano.
    async function describeValue(field: { entityId: string; name: string; dataType: string; validationRules: unknown }, value: string, recordId?: boolean) {
      if (recordId) {
        return withTenant(auth.tenantId, async tx => {
          const [record] = await tx.select({ data: records.customData }).from(records).where(and(eq(records.id, value), eq(records.entityId, field.entityId), eq(records.tenantId, auth.tenantId)))
          return String((record?.data as Record<string, unknown>)?.[field.name] ?? 'Registro seleccionado')
        })
      }
      if (field.dataType === 'select') return (field.validationRules as { options?: { value: string; label: string }[] })?.options?.find(option => option.value === value)?.label ?? value
      if (field.dataType === 'boolean') return value === 'true' ? 'Sí' : 'No'
      return value
    }
    function operatorPhrase(operator: string, dataType: string) {
      if (operator === 'lt') return dataType === 'date' ? 'antes de ' : 'menor que '
      if (operator === 'gt') return dataType === 'date' ? 'después de ' : 'mayor que '
      if (operator === 'lte') return dataType === 'date' ? 'hasta ' : 'menor o igual que '
      if (operator === 'gte') return dataType === 'date' ? 'desde ' : 'mayor o igual que '
      if (operator === 'contains') return 'contiene '
      return ''
    }
    const criteria: string[] = []
    // Filtros fijos del Diseñador (siempre aplicados, sin pregunta al
    // generar) - se muestran en la franja "Filtros aplicados" igual que los
    // parámetros respondidos, para que un reporte con criterios fijos no
    // se vea "sin filtros" en la vista previa.
    for (const filter of body.dsl.filters ?? []) {
      const { field } = planner.resolve(filter.source)
      const label = await describeValue(field, filter.value, filter.recordId)
      criteria.push(`${field.label}: ${operatorPhrase(filter.operator, field.dataType)}${label}`)
    }
    for (const parameter of body.dsl.parameters ?? []) {
      const answer = body.answers?.[parameter.id]
      if (!answer?.value?.trim()) continue
      const { field } = planner.resolve(parameter.source)
      const label = await describeValue(field, answer.value, parameter.input === 'select' ? answer.recordId : undefined)
      criteria.push(`${parameter.label}: ${operatorPhrase(answer.operator ?? (parameter.input === 'text' ? 'contains' : 'eq'), field.dataType)}${label}${parameter.input.endsWith('Range') ? ` a ${answer.end}` : ''}`)
    }
    return { ...result, criteria }
  } catch (err) {
    if (err instanceof PrintReportError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
