import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'

// GET /api/tenant (HU-ERD-61): datos de negocio/fiscales del propio tenant,
// para la pantalla Configuracion General (ERD-62). tenants no tiene RLS por
// tenant_id (ella ES el tenant) - el aislamiento lo da filtrar explicitamente
// por auth.tenantId, nunca por lo que mande el cliente.
//
// logoStorageKey NUNCA sale de aca (ruta de disco interna, ver
// server/utils/tenantLogo.ts) - se resume a `hasLogo`. El logo mismo se pide
// aparte a GET /api/tenant/logo (imagen binaria).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1)

  if (!tenant) {
    throw createError({ statusCode: 404, statusMessage: 'Tenant no encontrado' })
  }

  const { logoStorageKey, logoMimeType, logoFileName, logoSizeBytes, ...rest } = tenant
  return { ...rest, hasLogo: logoStorageKey != null, logoFileName, logoSizeBytes }
})
