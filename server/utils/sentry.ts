import * as Sentry from '@sentry/node'

// HU-ERD-20: SDK de Sentry para captura de errores no controlados.
// Si SENTRY_DSN no esta configurado (dev, o hasta que el equipo tenga una
// cuenta), Sentry.init() igual corre pero con enabled:false -> todas las
// llamadas (captureException, etc.) se vuelven no-op, sin romper nada.
let initialized = false

export function initSentry(): void {
  if (initialized) return
  initialized = true

  const dsn = process.env.SENTRY_DSN

  Sentry.init({
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: process.env.NODE_ENV || 'development',
    // Sin tracing de performance por ahora, solo captura de errores.
    tracesSampleRate: 0
  })
}

export { Sentry }
