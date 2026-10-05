import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvent } from 'h3'
import { Socket } from 'node:net'
import { IncomingMessage, ServerResponse } from 'node:http'
import { clientIp, clientIpFromHeaders, normalizeClientIp } from '../../server/utils/clientIp'
import { captureEdgeHost } from '../../server/utils/effectiveHost'
const headers = (values: Record<string, string>) => (name: string) => values[name]
afterEach(() => vi.unstubAllEnvs())
describe('IP confiable 190', () => {
  it('ignora CF/XFF/X-Real-IP falsos e inválidos por omisión', () => {
    vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'test-edge-190')
    vi.stubEnv('TRUSTED_PROXY_HOPS', '0')
    for (const secret of ['', 'incorrecto', 'test-edge-190 ']) expect(clientIpFromHeaders(headers({ 'cf-connecting-ip': '198.51.100.5', 'x-forwarded-for': '198.51.100.6', 'x-real-ip': '198.51.100.7', 'x-flow-edge-secret': secret }), '10.0.0.1')).toBe('10.0.0.1')
  })
  it('usa CF solo con secreto válido y conserva la decisión tras retirar cabeceras', () => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'test-edge-190')
    const req = new IncomingMessage(new Socket()); req.headers = { host: 'app.example.test', 'x-forwarded-host': 'sitio.example.test', 'x-flow-edge-secret': 'test-edge-190', 'cf-connecting-ip': '198.51.100.5' }
    const event = createEvent(req, new ServerResponse(req)); captureEdgeHost(event)
    expect(req.headers['x-flow-edge-secret']).toBeUndefined(); expect(clientIp(event)).toBe('198.51.100.5')
  })
  it('cuenta saltos desde la derecha, limita cadenas y rechaza configuraciones ambiguas', () => {
    const read = headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9, 10.0.0.2' })
    expect(clientIpFromHeaders(read, '10.0.0.1', false, '1')).toBe('10.0.0.2')
    expect(clientIpFromHeaders(read, '10.0.0.1', false, '2')).toBe('198.51.100.9')
    for (const value of ['-1', '1.5', '6', 'abc']) expect(clientIpFromHeaders(read, '10.0.0.1', false, value)).toBe('10.0.0.1')
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': Array(33).fill('1.2.3.4').join(',') }), '10.0.0.1', false, '1')).toBe('10.0.0.1')
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '1.2.3.4, invalid' }), '10.0.0.1', false, '1')).toBe('10.0.0.1')
  })
  it('normaliza IPv4 mapeada y todas las escrituras equivalentes de IPv6 /64', () => {
    expect(normalizeClientIp('::ffff:192.0.2.8')).toBe('192.0.2.8'); expect(normalizeClientIp('::ffff:c000:0208')).toBe('192.0.2.8')
    expect(normalizeClientIp('2001:0db8:0001:0002:1234:0000:0000:0001')).toBe('2001:db8:1:2::/64')
    expect(normalizeClientIp('2001:db8:1:2::abcd')).toBe('2001:db8:1:2::/64')
    expect(normalizeClientIp('2001:db8:1:3::1')).not.toBe(normalizeClientIp('2001:db8:1:2::1'))
    for (const value of ['unknown', '1.2.3.4:80', '[::1]', 'fe80::1%eth0']) expect(normalizeClientIp(value)).toBeUndefined()
  })
})
