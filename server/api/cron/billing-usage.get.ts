import { requireCronSecret } from '~/server/utils/cronAuth'
import { withSingleRunner, CRON_BILLING_USAGE } from '~/server/utils/singleRunner'
import { captureAllTenantUsage } from '~/server/utils/billing'

export default defineEventHandler(async (event) => {
  requireCronSecret(event)

  const result = await withSingleRunner(CRON_BILLING_USAGE, () => captureAllTenantUsage())

  if (!result.ran) {
    return { ok: true, skipped: true }
  }

  return { ok: true, skipped: false, ...result.result }
})
