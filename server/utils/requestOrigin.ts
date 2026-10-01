import { getRequestURL, type H3Event } from 'h3'

function permittedProtocol(url: URL, production: boolean) {
 return url.protocol === 'https:' || (!production && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
}

function configuredOrigin(value: string, production: boolean, originOnly = true): string | undefined {
 try {
  const url = new URL(value)
  // Solo un origen, sin credenciales, rutas, consultas ni fragmentos.
  if ((originOnly && !/^https?:\/\/[^/?#\\]+\/?$/i.test(value)) || url.username || url.password || !permittedProtocol(url, production)) return undefined
  return url.origin
 } catch { return undefined }
}

/** Orígenes web compartidos; no sustituye autenticación, permisos ni tokens. */
export function allowedRequestOrigins(event: H3Event): ReadonlySet<string> {
 const production = process.env.NODE_ENV === 'production'
 const origins = new Set<string>()
 const add = (value: string | undefined, originOnly = true) => {
  const origin = configuredOrigin(value?.trim() || '', production, originOnly)
  if (origin) origins.add(origin)
 }
 // Railway debe sobrescribir X-Forwarded-Host/Proto y cerrar el acceso directo
 // al upstream. Sus variables identifican el despliegue, no autentican al proxy.
 // Fuera de Railway (incluido Nuxt local directo) ignoramos ambas cabeceras.
 const railwayProxy = Boolean(process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL)
 try {
  const url = getRequestURL(event, { xForwardedHost: railwayProxy, xForwardedProto: railwayProxy })
  if (permittedProtocol(url, production)) origins.add(url.origin)
 } catch { /* Un host inválido no invalida los orígenes configurados. */ }
 // APP_BASE_URL conserva la extracción de origen aunque incluya una ruta.
 add(process.env.APP_BASE_URL, false)
 for (const value of [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_STATIC_URL]) {
  if (value) add(`https://${value.trim().replace(/^https:\/\//i, '')}`)
 }
 for (const value of (process.env.AGENT_ALLOWED_ORIGINS || '').split(',')) add(value)
 return origins
}
