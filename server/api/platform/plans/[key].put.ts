import { z } from 'zod'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { PLAN_CONCEPTS, savePlan } from '~/server/utils/plans'

const schema = z.object({
  code: z.string().trim().min(2).max(48).regex(/^[a-z0-9_-]+$/), name: z.string().trim().min(2).max(100),
  isActive: z.boolean(), isPublic: z.boolean(), sortOrder: z.number().int(),
  monthlyPriceCents: z.number().int().nonnegative(), annualPriceCents: z.number().int().nonnegative(),
  stripeMonthlyPriceId: z.string().trim().nullable(), stripeAnnualPriceId: z.string().trim().nullable(),
  limits: z.record(z.enum(PLAN_CONCEPTS), z.number().int().nonnegative().nullable())
})
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  await savePlan(await readValidatedBody(event, schema.parse), getRouterParam(event, 'key')!)
  return { ok: true }
})
