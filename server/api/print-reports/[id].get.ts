import { requireAuth, requirePermission } from '~/server/utils/rbac'
import { getPrintReport, PrintReportNotFoundError } from '~/server/utils/printReports'

// GET /api/print-reports/:id (HU-ERD-88) - detalle completo (incluye el dsl)
// para reabrir una plantilla guardada en el Diseñador, o para "Vista previa
// impresión" de un reporte guardado. El permiso se valida sobre la entidad
// base DEL REGISTRO (no se conoce hasta resolverlo) - por eso primero se
// autentica nomás (requireAuth, que además ya viene protegido por RLS via
// getPrintReport) y recién después se valida el permiso puntual.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')!

  try {
    const report = await getPrintReport(auth.tenantId, id)
    await requirePermission(event, report.baseEntitySlug, 'canRead')
    return report
  } catch (err) {
    if (err instanceof PrintReportNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
