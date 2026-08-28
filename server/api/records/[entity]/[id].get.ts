import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { revalidateIfDirty } from '~/server/utils/lazyRevalidation'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// GET /api/records/:entity/:id (HU-ERD-16)
export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')

  const row = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id)))
      .limit(1)
    if (!r) return r
    // HU-ERD-18: revalidacion perezosa en el proximo acceso al registro.
    return revalidateIfDirty(tx, r)
  })

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }
  return row
})
