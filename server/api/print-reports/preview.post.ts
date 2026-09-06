import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { printReportDslSchema } from '~/server/utils/printReport'
import { previewPrintReport } from '~/server/utils/printReports'
import { PrintReportError } from '~/server/utils/printReport'

// POST /api/print-reports/preview { dsl } (HU-ERD-88) - corre el DSL contra
// los datos VIGENTES sin guardar nada, tanto para "Vista previa impresión"
// del Diseñador (dsl todavía en edición, puede no existir aún como plantilla)
// como para reimprimir una plantilla ya guardada (el frontend le pasa el
// mismo dsl que le devolvió GET /api/print-reports/:id) - ver comentario
// largo sobre por qué nunca se congela un resultado, en server/db/schema.ts
// junto a la definición de `print_reports`.
const bodySchema = z.object({ dsl: printReportDslSchema })

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const { auth } = await requirePermission(event, body.dsl.baseEntity, 'canRead')

  try {
    return await previewPrintReport(auth.tenantId, body.dsl)
  } catch (err) {
    if (err instanceof PrintReportError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
