import cron from 'node-cron'
import { runOlapEtl } from '~/server/utils/olapEtl'
import { logger } from '~/server/utils/logger'
import { getLicenseStatus } from '~/server/utils/license'
import { withSingleRunner, CRON_OLAP_ETL } from '~/server/utils/singleRunner'

// ERD-87: cron local por lotes; en Vercel lo invoca la ruta protegida de cron.
// Deshabilitable via OLAP_ETL_ENABLED=false (tests, CI o depuración local).
export default defineNitroPlugin(() => {
  if (process.env.VERCEL) {
    logger.info('olap_etl_disabled', { reason: 'vercel_cron' })
    return
  }

  if (process.env.OLAP_ETL_ENABLED === 'false') {
    logger.info('olap_etl_disabled')
    return
  }

  let isRunning = false

  cron.schedule('*/15 * * * *', async () => {
    if (!getLicenseStatus().activated) return
    if (isRunning) {
      logger.warn('olap_etl_skip_overlap')
      return
    }
    isRunning = true
    const startedAt = Date.now()
    try {
      const budgetMs = Number(process.env.OLAP_ETL_BUDGET_MS) || 45_000
      const lockResult = await withSingleRunner(CRON_OLAP_ETL, () => runOlapEtl(new Date(), { budgetMs }))
      if (!lockResult.ran) {
        logger.warn('olap_etl_skip_overlap')
        return
      }
      const results = lockResult.result
      logger.info('olap_etl_run_ok', {
        durationMs: results.durationMs,
        tenants: results.tenants,
        recordsProcessed: results.recordsProcessed,
        batches: results.batches
      })
    } catch (err) {
      // runOlapEtl ya loguea el detalle por tenant - esto es el catch-all por
      // si algo revienta fuera del loop (ej. no se pudo ni listar tenants).
      logger.error('olap_etl_run_failed', {
        durationMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    } finally {
      isRunning = false
    }
  })

  logger.info('olap_etl_scheduled', { cron: '*/15 * * * *' })
})
