import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'

// GET /api/tenant/branding (ERD-62) - subconjunto NO admin-gated de
// GET /api/tenant, pensado para "Zone Encabezado" de un reporte imprimible
// (PrintReportSheet.vue): cualquier usuario con permiso para generar un
// reporte necesita el nombre/logo/datos fiscales de SU empresa ahi, no solo
// un administrador.
//
// Corrección (2026-09-11, revisión de diseño Pencil "Screen/Reporte - Vista
// previa", nodo SmVgI/OrgCol): el encabezado impreso SÍ trae una 3ra línea
// de contacto ("contacto@... · +52 ...") debajo de nombre/RFC+dirección -
// email/phone se sumaron a la selección (antes se excluían por "sin uso en
// el encabezado impreso", supuesto que este mock contradice). Sigue siendo
// el mismo criterio de "no admin-gated": ningún dato mas sensible que el que
// ya viajaba (fiscalData completo).
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

  const [tenant] = await db
    .select({ name: tenants.name, country: tenants.country, fiscalData: tenants.fiscalData, hasLogo: tenants.logoStorageKey, email: tenants.email, phone: tenants.phone })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)

  if (!tenant) {
    throw createError({ statusCode: 404, statusMessage: 'Tenant no encontrado' })
  }

  return { name: tenant.name, country: tenant.country, fiscalData: tenant.fiscalData, hasLogo: tenant.hasLogo != null, email: tenant.email, phone: tenant.phone }
})
