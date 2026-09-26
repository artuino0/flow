import { z } from 'zod'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { PLAN_CONCEPTS, savePlan } from '~/server/utils/plans'

const schema = z.object({
  code: z.string().trim().min(2).max(48).regex(/^[a-z0-9_-]+$/), name: z.string().trim().min(2).max(100),
  isActive: z.boolean().default(true), isPublic: z.boolean().default(true), sortOrder: z.number().int().default(100),
  monthlyPriceCents: z.number().int().nonnegative().default(0), annualPriceCents: z.number().int().nonnegative().default(0),
  stripeMonthlyPriceId: z.string().trim().nullable().default(null), stripeAnnualPriceId: z.string().trim().nullable().default(null),
  limits: z.record(z.enum(PLAN_CONCEPTS), z.number().int().nonnegative().nullable()).default({})
})
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  await savePlan(await readValidatedBody(event, schema.parse))
  setResponseStatus(event, 201)
  return { ok: true }
})
