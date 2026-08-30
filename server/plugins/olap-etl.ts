import cron from 'node-cron'
import { runOlapEtl } from '~/server/utils/olapEtl'
import { logger } from '~/server/utils/logger'

// HU-ERD-28: job node-cron que corre DENTRO del proceso Nitro (sin infraestructura
// aparte) cada 15 min, sincronizando el dominio transaccional al esquema OLAP
// (server/utils/olapEtl.ts). Deshabilitable via OLAP_ETL_ENABLED=false (tests, CI,
// o mientras se depura localmente sin querer que dispare cada 15 min).
//
// isRunning evita solapar corridas si una tarda mas de 15 min (un solo proceso
// Nitro - no hace falta un lock distribuido para el MVP). Si una corrida falla a
// mitad de camino, no se reintenta al toque: al no haber alertas externas en el
// MVP (criterio de aceptacion), se resuelve sola en la siguiente corrida gracias
// al solapamiento de la ventana de tiempo (ver LOOKBACK_MINUTES en olapEtl.ts).
export default defineNitroPlugin(() => {
  if (process.env.OLAP_ETL_ENABLED === 'false') {
    logger.info('olap_etl_disabled')
    return
  }

  let isRunning = false

  cron.schedule('*/15 * * * *', async () => {
    if (isRunning) {
      logger.warn('olap_etl_skip_overlap')
      return
    }
    isRunning = true
    const startedAt = Date.now()
    try {
      const results = await runOlapEtl()
      logger.info('olap_etl_run_ok', {
        durationMs: Date.now() - startedAt,
        tenants: results.length,
        recordsProcessed: results.reduce((sum, r) => sum + r.recordsProcessed, 0)
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
