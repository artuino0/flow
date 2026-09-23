import cron from 'node-cron'
import { runTriggerRetries } from '~/server/utils/triggerActions'
import { logger } from '~/server/utils/logger'
import { getLicenseStatus } from '~/server/utils/license'

// HU-ERD-49: job node-cron (mismo patron que server/plugins/olap-etl.ts,
// ERD-28) que reintenta los trigger_logs en status 'retrying' cuyo backoff
// exponencial ya vencio (computeBackoffMs(), ver server/utils/triggerActions.ts).
// Corre cada minuto (no cada 15 min como el ETL) porque una accion de trigger
// SI es sensible a latencia para quien espera el webhook - el primer backoff
// (2 min tras el intento 1) ya es la espera dominante, un cron mas fino no
// agrega carga real (la query por tenant es liviana: solo filas 'retrying').
//
// Deshabilitable via TRIGGER_RETRY_ENABLED=false (tests, CI, debug local sin
// querer que dispare cada minuto) - mismo criterio que OLAP_ETL_ENABLED.
export default defineNitroPlugin(() => {
  if (process.env.TRIGGER_RETRY_ENABLED === 'false') {
    logger.info('trigger_retry_disabled')
    return
  }

  let isRunning = false

  cron.schedule('* * * * *', async () => {
    if (!getLicenseStatus().activated) return
    if (isRunning) {
      logger.warn('trigger_retry_skip_overlap')
      return
    }
    isRunning = true
    const startedAt = Date.now()
    try {
      const results = await runTriggerRetries()
      const retried = results.reduce((sum, r) => sum + r.retried, 0)
      if (retried > 0) {
        logger.info('trigger_retry_run_ok', { durationMs: Date.now() - startedAt, tenants: results.length, retried })
      }
    } catch (err) {
      // runTriggerRetries ya loguea el detalle por tenant - esto es el
      // catch-all por si algo revienta fuera del loop (ej. no se pudo ni
      // listar tenants).
      logger.error('trigger_retry_run_failed', {
        durationMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    } finally {
      isRunning = false
    }
  })

  logger.info('trigger_retry_scheduled', { cron: '* * * * *' })
})
