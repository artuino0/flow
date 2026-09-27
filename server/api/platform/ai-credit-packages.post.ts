import { z } from 'zod'
import { withTenant } from '~/server/db'
import { aiCreditPackages } from '~/server/db/schema'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'

const bodySchema = z.object({ tenantId: z.string().uuid(), credits: z.number().int().positive().max(100000), origin: z.string().trim().min(3).max(200) }).strict()
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const [packageRow] = await withTenant(body.tenantId, tx => tx.insert(aiCreditPackages).values({ tenantId: body.tenantId, quantity: body.credits, remaining: body.credits, origin: body.origin }).returning())
  return packageRow
})
