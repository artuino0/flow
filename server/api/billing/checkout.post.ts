import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { BillingNotConfiguredError, createStripeCheckout, PlanNotAvailableError } from '~/server/utils/billing'

const bodySchema = z.object({ planCode: z.string().min(1).max(64), interval: z.enum(['month', 'year']) })

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = bodySchema.parse(await readBody(event))
  try {
    return await createStripeCheckout(auth.tenantId, body.planCode, body.interval)
  } catch (error) {
    if (error instanceof BillingNotConfiguredError || error instanceof PlanNotAvailableError) {
      throw createError({ statusCode: 422, statusMessage: error.message })
    }
    throw error
  }
})
