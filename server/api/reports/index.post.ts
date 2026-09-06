import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { isFeatureEnabled } from '~/server/utils/appConfig'
import { saveReport } from '~/server/utils/reports'
import { reportQueryDslSchema } from '~/server/utils/reportQuery'

// POST /api/reports { description, queryDsl, resultSnapshot } (Épica ERD-46,
// botón "Guardar reporte" de la previsualización) - persiste tal cual el
// queryDsl/resultSnapshot que ya devolvió POST /api/reports/preview (no
// vuelve a llamar a la IA ni a ejecutar la consulta), ver comentario largo
// en server/utils/reports.ts.
const bodySchema = z.object({
  description: z.string().trim().min(1).max(2000),
  queryDsl: reportQueryDslSchema,
  resultSnapshot: z.object({
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number()])))
  })
})

export default defineEventHandler(async (event) => {
  if (!isFeatureEnabled('reports')) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionalidad deshabilitada' })
  }

  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const report = await saveReport(auth.tenantId, auth.sub, body)
  setResponseStatus(event, 201)
  return report
})
