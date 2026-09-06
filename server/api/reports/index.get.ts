import { requireAdminRole } from '~/server/utils/rbac'
import { isFeatureEnabled } from '~/server/utils/appConfig'
import { listReports } from '~/server/utils/reports'

// GET /api/reports (Épica ERD-46) - listado simple de reportes guardados,
// más nuevo primero. Sin mock propio (el .pen solo diseñó "Nuevo reporte"),
// alcance mínimo agregado para que un reporte guardado sea alcanzable desde
// algún lado - ver comentario en server/utils/reports.ts.
export default defineEventHandler(async (event) => {
  if (!isFeatureEnabled('reports')) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionalidad deshabilitada' })
  }
  const auth = await requireAdminRole(event)
  return listReports(auth.tenantId)
})
