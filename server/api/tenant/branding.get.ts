import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'

// GET /api/tenant/branding (ERD-62) - subconjunto NO admin-gated de
// GET /api/tenant, pensado para "Zone Encabezado" de un reporte imprimible
// (PrintReportSheet.vue): cualquier usuario con permiso para generar un
// reporte necesita el nombre/logo/datos fiscales de SU empresa ahi, no solo
// un administrador (GET /api/tenant si sigue admin-gated: expone
// email/phone, mas sensible, sin uso en el encabezado impreso).
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

  const [tenant] = await db
    .select({ name: tenants.name, country: tenants.country, fiscalData: tenants.fiscalData, hasLogo: tenants.logoStorageKey })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)

  if (!tenant) {
    throw createError({ statusCode: 404, statusMessage: 'Tenant no encontrado' })
  }

  return { name: tenant.name, country: tenant.country, fiscalData: tenant.fiscalData, hasLogo: tenant.hasLogo != null }
})
