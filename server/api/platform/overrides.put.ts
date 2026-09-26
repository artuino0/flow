import { z } from 'zod'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { PLAN_CONCEPTS, saveTenantOverride } from '~/server/utils/plans'

const schema = z.object({ tenantId: z.string().uuid(), concept: z.enum(PLAN_CONCEPTS), value: z.number().int().nonnegative().nullable(), reason: z.string().trim().min(5).max(500), validFrom: z.string().datetime().nullable(), validUntil: z.string().datetime().nullable() })
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  const body = await readValidatedBody(event, schema.parse)
  await saveTenantOverride({ ...body, validFrom: body.validFrom ? new Date(body.validFrom) : null, validUntil: body.validUntil ? new Date(body.validUntil) : null })
  return { ok: true }
})
