import { runJobQueueTick } from '~/server/utils/jobQueue'
import { registerDefaultJobHandlers } from '~/server/utils/jobHandlers'
import { logger } from '~/server/utils/logger'
import { getLicenseStatus } from '~/server/utils/license'
import { jobQueueIntervalSeconds } from '~/server/utils/jobQueueInterval'

// Proceso de la cola de trabajos (correos y demás): periódicamente toma los trabajos
// listos por rondas justas entre organizaciones y los ejecuta con un ritmo
// máximo (JOB_QUEUE_RATE_PER_SECOND, por defecto 10/s, por debajo del límite de SES).
// En un servidor de larga vida corre solo; en un entorno serverless (Vercel) el
// mismo tick se invoca desde Vercel Cron en /api/cron/job-queue (ver esa ruta).
// Deshabilitable con JOB_QUEUE_ENABLED=false (pruebas, o cuando lo invoca un cron externo).
export default defineNitroPlugin((nitroApp) => {
  registerDefaultJobHandlers()
  if (process.env.JOB_QUEUE_ENABLED === 'false' || process.env.VERCEL) {
    logger.info('job_queue_disabled', { reason: process.env.VERCEL ? 'vercel_cron' : 'env' })
    return
  }

  let isRunning = false
  const intervalSeconds = jobQueueIntervalSeconds(process.env.NODE_ENV, process.env.JOB_QUEUE_INTERVAL_SECONDS)
  const timer = setInterval(async () => {
    if (!getLicenseStatus().activated) return
    if (isRunning) return
    isRunning = true
    const startedAt = Date.now()
    try {
      const result = await runJobQueueTick()
      if (result.claimed > 0 || result.recovered > 0) logger.info('job_queue_tick', { durationMs: Date.now() - startedAt, ...result })
    } catch (error) {
      logger.error('job_queue_tick_failed', { durationMs: Date.now() - startedAt, errorMessage: error instanceof Error ? error.message : String(error) })
    } finally {
      isRunning = false
    }
  }, intervalSeconds * 1000)
  nitroApp.hooks.hook('close', () => clearInterval(timer))
  logger.info('job_queue_scheduled', { intervalSeconds })
})
