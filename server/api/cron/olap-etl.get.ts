import { requireCronSecret } from '~/server/utils/cronAuth'
import { withSingleRunner, CRON_OLAP_ETL } from '~/server/utils/singleRunner'
import { runOlapEtl } from '~/server/utils/olapEtl'

export default defineEventHandler(async (event) => {
  requireCronSecret(event)
  const budgetMs = Number(process.env.OLAP_ETL_BUDGET_MS) || 45_000
  const result = await withSingleRunner(CRON_OLAP_ETL, () => runOlapEtl(new Date(), { budgetMs }))
  if (!result.ran) return { ok: true, skipped: true }
  return { ok: true, skipped: false, ...result.result }
})
