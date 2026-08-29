import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { tenantUpdateSchema } from '~/server/utils/tenantFiscal'

// PUT /api/tenant (HU-ERD-61): actualiza nombre/moneda/zona horaria/fiscal_data
// del propio tenant. fiscalData se revalida siempre del lado servidor contra
// el schema del pais resultante (nunca confiar en lo que ya paso el formulario).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, tenantUpdateSchema.parse)

  const [updated] = await db
    .update(tenants)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tenants.id, auth.tenantId))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Tenant no encontrado' })
  }

  return updated
})
