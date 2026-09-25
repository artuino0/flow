import { initSentry, Sentry } from '~/server/utils/sentry'
import { logger } from '~/server/utils/logger'
import { classifyObservabilityError } from '~/server/utils/observabilityError'

// HU-ERD-20: plugin de Nitro que arranca Sentry + logging estructurado.
// - request/afterResponse: log de acceso en JSON (metodo, path, status, duracion, tenant si hay auth).
// - error: captura errores no controlados, los manda a Sentry (no-op si no hay DSN) y los loguea.
export default defineNitroPlugin((nitroApp) => {
  initSentry()
  logger.info('nitro_boot', { sentryEnabled: Boolean(process.env.SENTRY_DSN) })

  nitroApp.hooks.hook('request', (event) => {
    event.context._startedAt = Date.now()
  })

  nitroApp.hooks.hook('afterResponse', (event) => {
    const startedAt = event.context._startedAt as number | undefined
    const auth = event.context.auth as { tenantId?: string } | undefined
    logger.info('http_request', {
      method: event.method,
      path: event.path,
      status: event.node.res.statusCode,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      tenantId: auth?.tenantId
    })
  })

  nitroApp.hooks.hook('error', (error, { event }) => {
    const level = classifyObservabilityError(error)
    const context = {
      errorMessage: error.message,
      stack: error.stack,
      path: event?.path,
      method: event?.method
    }
    if (level === 'warning') {
      logger.warn('handled_http_error', context)
      return
    }
    logger.error('unhandled_error', context)
    Sentry.captureException(error)
  })
})
