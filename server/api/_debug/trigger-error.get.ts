// GET /api/_debug/trigger-error (HU-ERD-20)
// Endpoint de prueba controlado para verificar el cableado de observabilidad:
// lanza un error intencional que el hook 'error' del plugin de observabilidad
// captura (logger.error en JSON + Sentry.captureException, no-op si no hay
// SENTRY_DSN configurado). Requiere autenticacion como cualquier otro
// endpoint (no esta en PUBLIC_PATHS), asi que no es explotable publicamente.
export default defineEventHandler(() => {
  throw createError({ statusCode: 500, statusMessage: 'Error de prueba intencional (HU-ERD-20)' })
})
