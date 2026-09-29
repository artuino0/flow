import cron from 'node-cron'
import { runTriggerRetries } from '~/server/utils/triggerActions'
import { logger } from '~/server/utils/logger'
import { getLicenseStatus } from '~/server/utils/license'
import { withSingleRunner, CRON_TRIGGER_RETRIES } from '~/server/utils/singleRunner'
import { withSystemRecordAccess } from '~/server/utils/recordActorContext'

// ERD-87: Job para reintentos vencidos de todos los tenants en una sola consulta.
// En Vercel se invoca vía /api/cron/trigger-retries. En local corre cada 15 minutos por node-cron.
// Se puede desactivar con TRIGGER_RETRY_ENABLED=false.
export default defineNitroPlugin(() => {
  if (process.env.VERCEL) {
    logger.info('trigger_retry_disabled', { reason: 'vercel_cron' })
    return
  }
  
  if (process.env.TRIGGER_RETRY_ENABLED === 'false') {
    logger.info('trigger_retry_disabled')
    return
  }

  let isRunning = false

  cron.schedule('*/15 * * * *', async () => {
    if (!getLicenseStatus().activated) return
    if (isRunning) {
      logger.warn('trigger_retry_skip_overlap')
      return
    }
    isRunning = true
    try {
      const budgetMs = Number(process.env.TRIGGER_RETRY_BUDGET_MS) || 40_000
      const result = await withSingleRunner(CRON_TRIGGER_RETRIES, () => withSystemRecordAccess(() => runTriggerRetries(new Date(), { budgetMs })))
      if (result.ran && (result.result.retried > 0 || result.result.failed > 0)) {
        logger.info('trigger_retry_run_ok', { durationMs: result.result.durationMs, due: result.result.due, retried: result.result.retried, failed: result.result.failed })
      }
    } catch (err) {
      logger.error('trigger_retry_run_failed', {
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    } finally {
      isRunning = false
    }
  })

  logger.info('trigger_retry_scheduled', { cron: '*/15 * * * *' })
})
