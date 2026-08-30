import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { getDashboardMetrics } from '~/server/utils/dashboardMetrics'

// GET /api/dashboard/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&tipoEvento=... (HU-ERD-31)
// Alimenta el dashboard interno con metricas agregadas desde el esquema OLAP
// (dim_cliente, dim_sucursal, fact_eventos, HU-ERD-27/28) del tenant autenticado,
// mas conteo de usuarios (tabla `users`, OLTP - ver nota de alcance en
// server/utils/dashboardMetrics.ts). Mismo guard que la configuracion general del
// tenant (HU-ERD-61): requiere el rol "de sistema" (roles.isSystem) del tenant, no
// existe un concepto de admin global en el sistema (ver dashboardMetrics.ts).
const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from debe ser YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to debe ser YYYY-MM-DD').optional(),
  tipoEvento: z.string().min(1).max(100).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  return getDashboardMetrics(auth.tenantId, {
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    tipoEvento: query.tipoEvento
  })
})
