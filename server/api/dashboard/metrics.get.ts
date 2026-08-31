import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { getDashboardMetrics } from '~/server/utils/dashboardMetrics'
import { isFeatureEnabled } from '~/server/utils/appConfig'

// GET /api/dashboard/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&tipoEvento=... (HU-ERD-31)
// Alimenta "Tablero" (ex-Dashboard, ex-"Inicio" - reubicado a la home /
// despues de HU-ERD-67 a pedido del usuario: no tiene sentido que la
// bienvenida vacia y el dashboard real fueran pantallas separadas) con
// metricas agregadas desde el esquema OLAP (dim_cliente, dim_sucursal,
// fact_eventos, HU-ERD-27/28) del tenant autenticado, mas conteo de usuarios
// (tabla `users`, OLTP - ver nota de alcance en server/utils/dashboardMetrics.ts).
//
// Guard: requireAuth (cualquier usuario autenticado del tenant, sin
// restriccion de rol) - originalmente usaba requireAdminRole (HU-ERD-31), pero
// al mudarse a la home/seccion General deja de tener sentido reservarlo a
// administradores: es la pantalla de aterrizaje de CUALQUIERA que entra a la app.
//
// HU-ERD-35: apagable con FEATURE_DASHBOARD=false (feature flag de punta a
// punta - tambien lo refleja pages/index.vue). Chequeo primero (sin DB) para
// que apagarlo sea un kill switch real, no solo cosmetico en el frontend.
const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from debe ser YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to debe ser YYYY-MM-DD').optional(),
  tipoEvento: z.string().min(1).max(100).optional()
})

export default defineEventHandler(async (event) => {
  if (!isFeatureEnabled('dashboard')) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionalidad deshabilitada' })
  }

  const auth = requireAuth(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  return getDashboardMetrics(auth.tenantId, {
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    tipoEvento: query.tipoEvento
  })
})
