import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// PUT /api/records/:entity/:id { customData } (HU-ERD-16)
const bodySchema = z.object({
  customData: z.record(z.any())
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')
  const body = await readValidatedBody(event, bodySchema.parse)

  const row = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .update(records)
      .set({ customData: body.customData, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id)))
      .returning()
    return r
  })

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }
  return row
})
