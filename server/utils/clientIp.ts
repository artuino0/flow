import { isIP } from 'node:net'
import { getHeader, type H3Event } from 'h3'
import { capturedEdgeClientIp, cloudflareHostMode, isTrustedCloudflareRequest, trustedEdge, trustedEdgeClientIpFromHeaders } from './effectiveHost'

/** Identidad de tasa: IPv6 /64; nunca una cabecera arbitraria del visitante. */
export function normalizeClientIp(value: string): string | undefined {
  const address = value.trim().toLowerCase()
  const family = isIP(address)
  if (family === 4) return address
  if (family !== 6 || address.includes('%')) return undefined
  let expanded = address
  if (expanded.includes('.')) {
    const split = expanded.lastIndexOf(':')
    const parts = expanded.slice(split + 1).split('.').map(Number)
    expanded = expanded.slice(0, split + 1) + ((parts[0]! << 8) + parts[1]!).toString(16) + ':' + ((parts[2]! << 8) + parts[3]!).toString(16)
  }
  const halves = expanded.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : []
  const words = halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left
  const values = words.map(word => parseInt(word, 16))
  if (values.slice(0, 5).every(word => word === 0) && values[5] === 65535) return `${values[6]! >> 8}.${values[6]! & 255}.${values[7]! >> 8}.${values[7]! & 255}`
  return values.slice(0, 4).map(word => word.toString(16)).join(':') + '::/64'
}

export function clientIpFromHeaders(read: (name: string) => string | undefined | null, socket: string | undefined, edge = cloudflareHostMode() && trustedEdge(read), hops = process.env.TRUSTED_PROXY_HOPS): string {
  if (edge) {
    const address = normalizeClientIp(trustedEdgeClientIpFromHeaders(read) ?? '')
    if (address) return address
  }
  // Solo activar cuando el ingreso está restringido al proxy de plataforma.
  // Se cuenta desde la derecha; nunca se acepta el prefijo enviado por el cliente.
  const count = Number(hops ?? 0), forwarded = read('x-forwarded-for') ?? ''
  if (Number.isInteger(count) && count >= 1 && count <= 5 && forwarded.length <= 2048) {
    const chain = forwarded.split(',')
    if (chain.length >= count && chain.length <= 32) {
      const address = normalizeClientIp(chain[chain.length - count] ?? '')
      if (address) return address
    }
  }
  return normalizeClientIp(socket ?? '') ?? 'unknown'
}

export function clientIp(event: H3Event) {
  const read = (name: string) => getHeader(event, name)
  // El middleware ya retiró el secreto: usa su decisión autenticada capturada.
  const captured = capturedEdgeClientIp(event)
  if (captured) return normalizeClientIp(captured) ?? 'unknown'
  return clientIpFromHeaders(read, event.node.req.socket.remoteAddress, isTrustedCloudflareRequest(event))
}
