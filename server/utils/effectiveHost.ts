import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, getRequestURL, type H3Event } from 'h3'

export function cloudflareHostMode() {
  return process.env.SITE_DOMAIN_PROVIDER?.trim().toLowerCase() === 'cloudflare'
}

function trustedEdge(read: (name: string) => string | undefined | null) {
  const expected = process.env.CLOUDFLARE_EDGE_SECRET?.trim()
  const supplied = read('x-flow-edge-secret')
  if (!expected || !supplied) return false
  // Longitud fija incluso cuando el secreto recibido tiene otra longitud.
  return timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest())
}

export function effectiveHostFromHeaders(read: (name: string) => string | undefined | null, legacyForwarded = true) {
  const forwarded = cloudflareHostMode() ? trustedEdge(read) : legacyForwarded
  const raw = (forwarded ? read('x-forwarded-host')?.split(',')[0]?.trim() : '') || read('host') || ''
  // Una autoridad, nunca URL, credenciales, ruta o cabeceras concatenadas.
  if (!raw || /[\s/@\\?#,]/.test(raw)) return ''
  try { return new URL(`http://${raw}`).host.toLowerCase().replace(/\.(?=:|$)/, '') } catch { return '' }
}

interface EdgeHost { host: string; trusted: boolean }
export function isTrustedCloudflareRequest(event: H3Event) {
  return cloudflareHostMode() && ((event.context.flowEdgeHost as EdgeHost | undefined)?.trusted ?? trustedEdge(name => getHeader(event, name)))
}
export function captureEdgeHost(event: H3Event) {
  if (!cloudflareHostMode() || event.context.flowEdgeHost) return
  const read = (name: string) => getHeader(event, name)
  event.context.flowEdgeHost = { host: effectiveHostFromHeaders(read), trusted: trustedEdge(read) } satisfies EdgeHost
  // Ningún consumidor posterior puede reenviar o reflejar estas cabeceras.
  delete event.node.req.headers['x-flow-edge-secret']
  delete event.node.req.headers['x-forwarded-host']
}

export function effectiveRequestHost(event: H3Event, legacyForwarded = true) {
  const captured = event.context.flowEdgeHost as EdgeHost | undefined
  return captured?.host ?? effectiveHostFromHeaders(name => getHeader(event, name), legacyForwarded)
}

export function effectiveRequestHostname(event: H3Event) {
  const host = effectiveRequestHost(event)
  try { return new URL(`http://${host}`).hostname } catch { return '' }
}

export function effectiveRequestURL(event: H3Event, legacyForwarded = false, legacyProto = true) {
  const url = getRequestURL(event, { xForwardedHost: false, xForwardedProto: legacyProto })
  const host = effectiveRequestHost(event, legacyForwarded)
  if (!host) throw createError({ statusCode: 400, statusMessage: 'Host inválido.' })
  url.port = ''
  url.host = host
  if (isTrustedCloudflareRequest(event)) url.protocol = 'https:'
  return url
}
