import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { printReportDslSchema } from '~/server/utils/printReport'
import { createPrintReport } from '~/server/utils/printReports'

// POST /api/print-reports { title, dsl } (HU-ERD-88, botón "Guardar reporte"
// del Diseñador de 3 columnas) - crea una plantilla nueva. El permiso se
// valida sobre dsl.baseEntity (recién conocido tras parsear el body), no
// sobre un parámetro de ruta - mismo motivo que index.get.ts de acá al lado.
const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  dsl: printReportDslSchema
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const { auth } = await requirePermission(event, body.dsl.baseEntity, 'canRead')

  const report = await createPrintReport(auth.tenantId, auth.sub, body)
  setResponseStatus(event, 201)
  return report
})
