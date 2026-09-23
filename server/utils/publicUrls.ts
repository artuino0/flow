/** URL pública del deployment. No debe caer a localhost en correos o assets. */
export function getPublicAppBaseUrl() {
  const raw = process.env.APP_BASE_URL?.trim()
  const deployedOnVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NUXT_ENV_VERCEL_ENV)
  const isLocal = raw ? /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(raw) : false
  if (raw && !(deployedOnVercel && isLocal)) return raw.replace(/\/+$/, '')
  const host = process.env.NUXT_ENV_VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.NUXT_ENV_VERCEL_URL
    || process.env.VERCEL_URL
  if (host) return `https://${host.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
  return `http://localhost:${process.env.APP_PORT || '3001'}`
}
