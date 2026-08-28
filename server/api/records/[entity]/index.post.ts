import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// POST /api/records/:entity { customData } (HU-ERD-16)
// La validacion real de customData contra entity_fields (Zod dinamico) es
// HU-ERD-17; aca solo se exige que sea un objeto.
const bodySchema = z.object({
  customData: z.record(z.any()).default({})
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canCreate')
  const body = await readValidatedBody(event, bodySchema.parse)

  const row = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .insert(records)
      .values({ entityId: entity.id, tenantId: auth.tenantId, customData: body.customData })
      .returning()
    return r
  })

  setResponseStatus(event, 201)
  return row
})
