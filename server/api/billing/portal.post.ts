import { requireAdminRole } from '~/server/utils/rbac'
import { BillingNotConfiguredError, createStripePortal } from '~/server/utils/billing'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  try {
    return await createStripePortal(auth.tenantId)
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) throw createError({ statusCode: 422, statusMessage: error.message })
    throw error
  }
})
