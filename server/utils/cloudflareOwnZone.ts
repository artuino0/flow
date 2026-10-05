import { promises as dns } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { getDomain } from 'tldts'
import type { DnsInstruction } from './siteDomains'
import { isReservedSiteHostname } from './siteDomainHostnames'

const normalized = (value: string) => value.trim().toLowerCase().replace(/\.$/, '')
export function isCloudflareOwnZoneHostname(hostname: string) {
  const explicit = (process.env.CLOUDFLARE_OWN_ZONE_HOSTNAMES ?? '').split(',').map(normalized).filter(Boolean)
  const zone = normalized(process.env.CLOUDFLARE_ZONE_NAME ?? '')
  // Una lista explícita restringe el alcance; el sufijo se usa solo sin lista.
  return explicit.length ? explicit.includes(hostname) : Boolean(zone && (hostname === zone || hostname.endsWith(`.${zone}`)))
}
export function ownZoneDns(hostname: string): DnsInstruction[] {
  const origin = process.env.CLOUDFLARE_FALLBACK_ORIGIN?.trim()
  if (!origin) return []
  return [{ type: 'CNAME', name: getDomain(hostname) === hostname ? '@' : hostname, value: origin, purpose: 'routing' }]
}
const ranges = new BlockList()
// Listados públicos oficiales, verificados 2026-10-04. Sin consultas remotas al cargarlos.
for (const cidr of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']) {
  const [address, prefix] = cidr.split('/')
  ranges.addSubnet(address!, Number(prefix), isIP(address!) === 6 ? 'ipv6' : 'ipv4')
}
export function isCloudflareAddress(address: string) {
  const family = isIP(address)
  return Boolean(family && ranges.check(address, family === 6 ? 'ipv6' : 'ipv4'))
}
async function cloudflareDns(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]).then(results => results.flatMap(result => result.status === 'fulfilled' ? result.value : [])),
      new Promise<string[]>(resolve => { timer = setTimeout(() => resolve([]), 2000) })
    ])
    return addresses.length > 0 && addresses.every(isCloudflareAddress)
  } finally { if (timer) clearTimeout(timer) }
}
async function edgeResponse(response: Response) {
  if (!response.body) return {}
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 4096) { await reader.cancel(); return {} }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch { return {} } finally { reader.releaseLock() }
}
export async function registerOwnZoneHostname(hostname: string) {
  if (isReservedSiteHostname(hostname)) throw createError({ statusCode: 422, statusMessage: 'Este dominio está reservado para la aplicación o su infraestructura.' })
  if (!isCloudflareOwnZoneHostname(hostname) || !ownZoneDns(hostname).length) throw createError({ statusCode: 503, statusMessage: 'El administrador debe configurar el origen y los dominios gestionados por la zona de Flow.' })
  const dnsVerified = await cloudflareDns(hostname)
  let edgeVerified = false
  if (dnsVerified) {
    const nonce = randomUUID()
    try {
      const response = await fetch(`https://${hostname}/.well-known/flow-site-edge?nonce=${nonce}`, {
        method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(3000)
      })
      const body = response.ok && response.headers.has('cf-ray') ? await edgeResponse(response) : {}
      edgeVerified = body.edge === true && body.hostname === hostname && body.nonce === nonce
    } catch { edgeVerified = false }
  }
  return {
    hostname, managedByZone: true, managementReason: 'own_zone',
    dnsRecords: ownZoneDns(hostname), dnsVerified, edgeVerified,
    checkedAt: new Date().toISOString(), status: dnsVerified && edgeVerified ? 'active' : 'pending',
    ssl: { status: edgeVerified ? 'active' : 'pending' }
  }
}
