import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { applyBlueprint } from '~/server/utils/blueprint/apply'

const bodySchema = z.object({ blueprint: z.unknown(), idempotencyKey: z.string().trim().min(1).max(200) })

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  return applyBlueprint(auth.tenantId, auth.sub, body.blueprint, body.idempotencyKey)
})
