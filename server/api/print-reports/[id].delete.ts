import { requireAdminRole, requirePermission } from '~/server/utils/rbac'
import { getPrintReport, deletePrintReport, PrintReportNotFoundError } from '~/server/utils/printReports'

// DELETE /api/print-reports/:id (HU-ERD-88) - borrado físico (no hay "papelera"
// de plantillas de reporte, a diferencia de records - son metadatos de
// configuración, no datos del negocio).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  try {
    const existing = await getPrintReport(auth.tenantId, id)
    await requirePermission(event, existing.baseEntitySlug, 'canRead')
    await deletePrintReport(auth.tenantId, id)
    setResponseStatus(event, 204)
    return null
  } catch (err) {
    if (err instanceof PrintReportNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
