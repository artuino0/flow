import { requirePermission } from '~/server/utils/rbac'
import { listPrintReports } from '~/server/utils/printReports'

// GET /api/print-reports?baseEntity=<slug> (HU-ERD-88) - "REPORTES GUARDADOS"
// de Screen/Generar reporte, más recién editado primero. `baseEntity` es
// obligatorio: el punto de entrada real (botón "Generar reporte") siempre
// vive dentro del listado de una entidad puntual, y el permiso a validar es
// justamente "puede leer esa entidad" (mismo criterio que server/api/records/
// [entity]/import.post.ts: una acción sobre datos de un módulo se gatea con
// el permiso de ESE módulo, no con requireAdminRole).
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const baseEntity = typeof query.baseEntity === 'string' ? query.baseEntity : undefined
  if (!baseEntity) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el parámetro "baseEntity"' })
  }
  const { auth } = await requirePermission(event, baseEntity, 'canRead')
  return listPrintReports(auth.tenantId, baseEntity)
})
