import { createError } from 'h3'
import type { DnsInstruction, SiteDomainProvider } from './siteDomains'
import { isCloudflareOwnZoneHostname, ownZoneDns, registerOwnZoneHostname } from './cloudflareOwnZone'

const safeError = 'No pudimos registrar el dominio con el proveedor. Inténtalo más tarde o contacta a soporte.'
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function config() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const zone = process.env.CLOUDFLARE_ZONE_ID?.trim()
  const target = process.env.CLOUDFLARE_CNAME_TARGET?.trim()
  const secret = process.env.CLOUDFLARE_EDGE_SECRET?.trim()
  return token && zone && target && secret ? { token, zone, target, secret } : null
}
function requireConfig() {
  const value = config()
  if (!value) throw createError({ statusCode: 503, statusMessage: 'El administrador debe configurar la conexión del proveedor de dominios de Flow Sites.' })
  return value
}
async function request(path: string, method = 'GET', payload?: unknown, missingAllowed = false) {
  const value = requireConfig()
  let response: Response
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(value.zone)}/custom_hostnames${path}`, {
      method, headers: { authorization: `Bearer ${value.token}`, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    })
  } catch {
    console.error('[Sites Cloudflare] No se pudo contactar al proveedor')
    throw createError({ statusCode: 502, statusMessage: safeError })
  }
  if (missingAllowed && response.status === 404) return null
  const body = object(await response.json().catch(() => null))
  if (!response.ok || body.success !== true) {
    const detail = JSON.stringify(body.errors ?? [])
      .split(value.token).join('[redactado]').split(value.secret).join('[redactado]')
    console.error('[Sites Cloudflare] Error del proveedor:', response.status, detail)
    throw createError({ statusCode: 502, statusMessage: safeError })
  }
  return body.result
}
function hostnameResult(value: unknown, hostname: string): Record<string, unknown> & { id: string; hostname: string } {
  const result = object(value)
  if (typeof result.id !== 'string' || !result.id || (result.hostname !== undefined && result.hostname !== hostname)) {
    console.error('[Sites Cloudflare] Respuesta sin identificador o con hostname distinto')
    throw createError({ statusCode: 502, statusMessage: safeError })
  }
  return { ...result, id: result.id, hostname }
}
async function find(hostname: string) {
  const result = await request(`?hostname=${encodeURIComponent(hostname)}`)
  if (!Array.isArray(result)) throw createError({ statusCode: 502, statusMessage: safeError })
  const matches = result.filter(item => object(item).hostname === hostname)
  if (matches.length > 1) throw createError({ statusCode: 502, statusMessage: safeError })
  return matches.length ? hostnameResult(matches[0], hostname) : null
}
function stored(data?: Record<string, unknown>) { return object(data?.cloudflare ?? data) }
function verified(data: Record<string, unknown>) {
  const value = stored(data)
  if (value.managedByZone === true) return value.dnsVerified === true && value.edgeVerified === true
  return value.status === 'active' && object(value.ssl).status === 'active'
}
export function cloudflarePresentation(data: Record<string, unknown>) {
  const value = stored(data), ssl = object(value.ssl)
  const errors = [value.verification_errors, ssl.validation_errors].flatMap(items => Array.isArray(items) ? items : [])
  const failed = ['blocked', 'deleted', 'moved', 'pending_deletion'].includes(String(value.status)) || ['validation_timed_out', 'expired', 'deleted'].includes(String(ssl.status)) || errors.length > 0
  const text = JSON.stringify(errors).toLowerCase()
  const reason = text.includes('caa') ? 'Los registros CAA impiden emitir el certificado.'
    : text.includes('dns') || text.includes('token') ? 'Revisa los registros DNS de validación.'
      : 'La validación del dominio requiere revisión. Comprueba los registros DNS o contacta a soporte.'
  return {
    ownershipVerified: value.managedByZone === true ? value.dnsVerified === true : value.status === 'active', certificateVerified: ssl.status === 'active',
    managedByZone: value.managedByZone === true,
    verificationState: failed ? 'error' : verified(data) ? 'active' : value.status === 'active' || value.dnsVerified === true ? 'certificate' : 'dns',
    validationError: failed ? reason : null
  }
}
export function cloudflarePublicData(data: Record<string, unknown>) {
  const value = stored(data), ssl = object(value.ssl), presentation = cloudflarePresentation(data)
  // Conservar la respuesta completa en BD; la API de UI solo expone campos públicos.
  return { ...data, cloudflare: {
    id: value.id, hostname: value.hostname, status: value.status,
    managedByZone: value.managedByZone, managementReason: value.managementReason,
    dnsVerified: value.dnsVerified, edgeVerified: value.edgeVerified,
    ownership_verification: value.ownership_verification,
    ssl: { status: ssl.status, validation_records: ssl.validation_records },
    validationError: presentation.validationError
  } }
}
export function cloudflareSiteDomainProvider(): SiteDomainProvider {
  return {
    name: 'cloudflare', configured: Boolean(config()),
    register: async hostname => {
      requireConfig()
      if (isCloudflareOwnZoneHostname(hostname)) return registerOwnZoneHostname(hostname)
      return hostnameResult(await request('', 'POST', { hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }), hostname)
    },
    status: async (hostname, data) => {
      const previous = stored(data)
      if (previous.managedByZone === true || isCloudflareOwnZoneHostname(hostname)) {
        requireConfig()
        return registerOwnZoneHostname(hostname)
      }
      const current = typeof previous.id === 'string'
        ? hostnameResult(await request(`/${encodeURIComponent(previous.id)}`), hostname) : await find(hostname)
      if (!current) throw createError({ statusCode: 502, statusMessage: safeError })
      const ssl = object(current.ssl)
      if (['pending_validation', 'pending', 'validation_timed_out'].includes(String(ssl.status)) && typeof ssl.method === 'string' && typeof ssl.type === 'string') {
        const retried = hostnameResult(await request(`/${encodeURIComponent(current.id)}`, 'PATCH', { ssl: {
          method: ssl.method, type: ssl.type, ...(ssl.settings && typeof ssl.settings === 'object' ? { settings: ssl.settings } : {})
        } }), hostname)
        return { ...current, ...retried, ssl: { ...ssl, ...object(retried.ssl) } }
      }
      return current
    },
    remove: async (hostname, data) => {
      const previous = stored(data)
      if (previous.managedByZone === true || isCloudflareOwnZoneHostname(hostname)) return
      const current = typeof previous.id === 'string' && previous.id ? previous : await find(hostname)
      if (current) await request(`/${encodeURIComponent(String(current.id))}`, 'DELETE', undefined, true)
    },
    dns: (hostname, data) => {
      if (stored(data).managedByZone === true || isCloudflareOwnZoneHostname(hostname)) return ownZoneDns(hostname)
      const target = process.env.CLOUDFLARE_CNAME_TARGET?.trim()
      const value = stored(data)
      const result: DnsInstruction[] = target ? [{ type: 'CNAME', name: hostname, value: target, purpose: 'routing' }] : []
      const ownership = object(value.ownership_verification)
      if (String(ownership.type).toUpperCase() === 'TXT' && typeof ownership.name === 'string' && typeof ownership.value === 'string') {
        result.push({ type: 'TXT', name: ownership.name, value: ownership.value, purpose: 'ownership' })
      }
      const records = object(value.ssl).validation_records
      for (const item of Array.isArray(records) ? records : []) {
        const record = object(item)
        if (typeof record.txt_name === 'string' && typeof record.txt_value === 'string') result.push({ type: 'TXT', name: record.txt_name, value: record.txt_value, purpose: 'ownership' })
      }
      return result
    }, verified
  }
}
