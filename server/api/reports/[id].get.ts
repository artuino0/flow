import { requireAdminRole } from '~/server/utils/rbac'
import { isFeatureEnabled } from '~/server/utils/appConfig'
import { getReport, ReportNotFoundError } from '~/server/utils/reports'

// GET /api/reports/:id (Épica ERD-46) - detalle de un reporte guardado
// (incluye resultSnapshot, la vista previa congelada al momento de guardar).
export default defineEventHandler(async (event) => {
  if (!isFeatureEnabled('reports')) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionalidad deshabilitada' })
  }
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!

  try {
    return await getReport(auth.tenantId, id)
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
