import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { tenantUpdateSchema } from '~/server/utils/tenantFiscal'
import { invalidateTenantAccess } from '~/server/utils/shortCache'

// PUT /api/tenant (HU-ERD-61): actualiza nombre/moneda/zona horaria/fiscal_data
// del propio tenant. fiscalData se revalida siempre del lado servidor contra
// el schema del pais resultante (nunca confiar en lo que ya paso el formulario).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const raw = await readBody(event)
  const [current] = await db.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1)
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Organización no encontrada' })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'Datos de configuración inválidos' })
  const fiscalData = raw.fiscalData && typeof raw.fiscalData === 'object' && !Array.isArray(raw.fiscalData)
    ? {
        ...raw.fiscalData,
        ...(typeof raw.fiscalData.rfc === 'string' ? { rfc: raw.fiscalData.rfc.trim().toUpperCase() } : {})
      }
    : raw.fiscalData
  const parsed = tenantUpdateSchema.safeParse({ ...raw, fiscalData, country: raw.country ?? current.country, idleTimeoutMinutes: raw.idleTimeoutMinutes ?? current.idleTimeoutMinutes, idleWarningMinutes: raw.idleWarningMinutes ?? current.idleWarningMinutes })
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Revisa los datos', data: { errors: parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) } })
  const body = parsed.data
  if (body.timezone) {
    try { new Intl.DateTimeFormat('es-MX', { timeZone: body.timezone }) } catch { throw createError({ statusCode: 400, statusMessage: 'Zona horaria inválida' }) }
  }

  const [updated] = await db
    .update(tenants)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tenants.id, auth.tenantId))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Tenant no encontrado' })
  }

  // La moneda por defecto viaja en la definición de los módulos que se guarda en memoria.
  invalidateTenantAccess(auth.tenantId)
  return updated
})

