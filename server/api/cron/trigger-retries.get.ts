import { requireCronSecret } from '~/server/utils/cronAuth'
import { withSingleRunner, CRON_TRIGGER_RETRIES } from '~/server/utils/singleRunner'
import { runTriggerRetries } from '~/server/utils/triggerActions'
import { withSystemRecordAccess } from '~/server/utils/recordActorContext'

export default defineEventHandler(async (event) => {
  requireCronSecret(event)

  const budgetMs = Number(process.env.TRIGGER_RETRY_BUDGET_MS) || 40_000
  const result = await withSingleRunner(CRON_TRIGGER_RETRIES, () => withSystemRecordAccess(() => runTriggerRetries(new Date(), { budgetMs })))

  if (!result.ran) {
    return { ok: true, skipped: true }
  }

  return { ok: true, skipped: false, ...result.result }
})
