import cron from 'node-cron'
import { captureAllTenantUsage } from '~/server/utils/billing'
import { logger } from '~/server/utils/logger'
import { withSingleRunner, CRON_BILLING_USAGE } from '~/server/utils/singleRunner'

// Historial diario de consumo. No depende de Stripe: conserva la tendencia
// incluso cuando el tenant está en prueba, manual u on-premise.
export default defineNitroPlugin(() => {
  if (process.env.VERCEL) {
    logger.info('billing_usage_snapshots_disabled', { reason: 'vercel_cron' })
    return
  }

  if (process.env.BILLING_USAGE_SNAPSHOTS_ENABLED === 'false') {
    logger.info('billing_usage_snapshots_disabled')
    return
  }
  let running = false
  cron.schedule('10 0 * * *', async () => {
    if (running) return
    running = true
    try {
      const result = await withSingleRunner(CRON_BILLING_USAGE, () => captureAllTenantUsage())
      if (result.ran) {
        logger.info('billing_usage_snapshots_captured', result.result)
      }
    } catch (error) {
      logger.error('billing_usage_snapshots_failed', { errorMessage: error instanceof Error ? error.message : String(error) })
    } finally {
      running = false
    }
  }, { timezone: 'America/Mexico_City' })
  logger.info('billing_usage_snapshots_scheduled', { cron: '10 0 * * *' })
})
