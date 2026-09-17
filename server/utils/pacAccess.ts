import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'

// Decision cerrada de la HU (DOCS/HU_Timbrado_CFDI_PAC.md, 2026-09-14):
// "Facturación" se OCULTA en tenants no-MX - la UI no muestra la seccion y el
// servidor la corta con 404 (defensa en profundidad: aunque alguien navegue a
// /ajustes?section=facturacion a mano, los endpoints no responden). Admin-only
// como el resto de Configuracion General (ERD-61/62), incluidas API keys: las
// credenciales del PAC son configuracion administrativa, nunca operacion.
export async function requireMxBillingAdmin(event: H3Event) {
  const auth = await requireAdminRole(event)
  const [tenant] = await db.select({ country: tenants.country }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1)
  if (!tenant) {
    throw createError({ statusCode: 404, statusMessage: 'Tenant no encontrado' })
  }
  if (tenant.country !== 'MX') {
    throw createError({ statusCode: 404, statusMessage: 'La facturación electrónica solo está disponible para organizaciones en México' })
  }
  return auth
}
