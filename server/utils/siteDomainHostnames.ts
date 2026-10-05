import { getDomain } from 'tldts'

export function reservedSiteHostnames() {
  const values = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  for (const raw of [process.env.APP_BASE_URL, process.env.VERCEL_URL, process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.CLOUDFLARE_FALLBACK_ORIGIN, process.env.CLOUDFLARE_CNAME_TARGET]) {
    if (!raw) continue
    try { values.add(new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase()) } catch { /* Configuración incompleta. */ }
  }
  const zone = process.env.CLOUDFLARE_ZONE_NAME?.trim().toLowerCase().replace(/\.$/, '')
    || getDomain(process.env.CLOUDFLARE_CNAME_TARGET ?? '')
  if (zone) values.add(`app.${zone}`)
  return values
}
export function isReservedSiteHostname(hostname: string) {
  return reservedSiteHostnames().has(hostname) || hostname.endsWith('.vercel.app')
}
