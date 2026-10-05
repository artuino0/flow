import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { captureEdgeHost, effectiveRequestHost, effectiveRequestURL } from '../../server/utils/effectiveHost'
import { clientIp } from '../../server/utils/clientIp'
import worker from '../../scripts/cloudflareSiteWorker.mjs'

beforeEach(() => { vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'worker-test-secret'); vi.stubEnv('TRUSTED_PROXY_HOPS', '0') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
function event(secret = 'worker-test-secret', original = 'FLOW.Cliente.Test.') {
  const socket = new Socket(); Object.defineProperty(socket, 'remoteAddress', { value: '10.0.0.1' })
  const req = new IncomingMessage(socket); req.url = '/agenda?x=1'
  req.headers = { host: 'app.dydasoftware.com', 'x-forwarded-host': 'app.dydasoftware.com', 'x-flow-original-host': original, 'x-flow-client-ip': '198.51.100.19', 'cf-connecting-ip': '10.0.0.2', 'x-flow-edge-secret': secret }
  return createEvent(req, new ServerResponse(req))
}
describe('Worker y captura tras proxy Railway, todo simulado', () => {
  it('prioriza host/IP propios y conserva captura tras borrado e intento de mutación', () => {
    const e = event(); expect(effectiveRequestURL(e).origin).toBe('https://flow.cliente.test'); expect(clientIp(e)).toBe('198.51.100.19')
    captureEdgeHost(e)
    for (const name of ['x-flow-original-host', 'x-flow-client-ip', 'x-flow-edge-secret', 'x-forwarded-host']) expect(e.node.req.headers[name]).toBeUndefined()
    e.node.req.headers['x-flow-original-host'] = 'evil.test'; e.node.req.headers['x-flow-client-ip'] = '203.0.113.4'; captureEdgeHost(e)
    expect(effectiveRequestHost(e)).toBe('flow.cliente.test'); expect(clientIp(e)).toBe('198.51.100.19')
  })
  it.each(['', 'incorrecto'])('ignora host/IP propios forjados con secreto %s', secret => {
    const e = event(secret); expect(effectiveRequestHost(e)).toBe('app.dydasoftware.com'); expect(clientIp(e)).toBe('10.0.0.1')
    captureEdgeHost(e); expect(effectiveRequestHost(e)).toBe('app.dydasoftware.com'); expect(clientIp(e)).toBe('10.0.0.1')
    expect(e.node.req.headers['x-flow-client-ip']).toBeUndefined(); expect(e.node.req.headers['x-flow-original-host']).toBeUndefined()
  })
  it.each(['https://evil.test', 'user@evil.test', 'evil.test/a', 'a.test,b.test', 'a.test b.test', ''])('no acepta autoridad propia inválida: %s', authority => {
    const e = event('worker-test-secret', authority); captureEdgeHost(e); expect(effectiveRequestHost(e)).toBe('')
  })
  it('sin cabeceras propias conserva respaldo; IP inválida usa CF válido, IPv6 se agrupa', () => {
    const e = event(); delete e.node.req.headers['x-flow-original-host']; delete e.node.req.headers['x-flow-client-ip']; e.node.req.headers['x-forwarded-host'] = 'fallback.test'
    captureEdgeHost(e); expect(effectiveRequestHost(e)).toBe('fallback.test'); expect(clientIp(e)).toBe('10.0.0.2')
    const invalid = event(); invalid.node.req.headers['x-flow-client-ip'] = 'invalid'; captureEdgeHost(invalid); expect(clientIp(invalid)).toBe('10.0.0.2')
    const v6 = event(); v6.node.req.headers['x-flow-client-ip'] = '2001:db8:1:2::9'; captureEdgeHost(v6); expect(clientIp(v6)).toBe('2001:db8:1:2::/64')
  })
  it('modo ajeno a Cloudflare ignora ambas cabeceras propias aun con secreto correcto', () => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', 'railway'); const e = event(); captureEdgeHost(e)
    expect(effectiveRequestHost(e)).toBe('app.dydasoftware.com'); expect(clientIp(e)).toBe('10.0.0.1')
  })
  it('Worker sobrescribe cuatro valores, preserva cuerpo/path/query y no sigue redirección', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 301, headers: { location: 'https://elsewhere.test' } })); vi.stubGlobal('fetch', network)
    const headers = { 'CF-Connecting-IP': '198.51.100.19', 'X-Flow-Original-Host': 'forged.test', 'X-Flow-Client-IP': '203.0.113.1', 'X-Forwarded-Host': 'forged.test', 'X-Flow-Edge-Secret': 'forged-secret' }
    const response = await worker.fetch(new Request('https://flow.dydasoftware.com/agenda?x=1', { method: 'POST', headers, body: 'contenido' }), { CLOUDFLARE_EDGE_SECRET: 'worker-test-secret' })
    expect(response.status).toBe(301); expect(network).toHaveBeenCalledOnce()
    const upstream = network.mock.calls[0]![0] as Request
    expect(upstream.url).toBe('https://app.dydasoftware.com/agenda?x=1'); expect(upstream.redirect).toBe('manual'); expect(upstream.method).toBe('POST'); expect(await upstream.text()).toBe('contenido')
    expect(upstream.headers.get('X-Flow-Original-Host')).toBe('flow.dydasoftware.com'); expect(upstream.headers.get('X-Flow-Client-IP')).toBe('198.51.100.19'); expect(upstream.headers.get('X-Forwarded-Host')).toBe('flow.dydasoftware.com'); expect(upstream.headers.get('X-Flow-Edge-Secret')).toBe('worker-test-secret')
    expect(network.mock.calls[0]![1]).toEqual({ cf: { cacheEverything: false, cacheTtl: 0 } })
  })
  it.each(['app.dydasoftware.com', 'customers.dydasoftware.com'])('Worker excluye %s y borra datos privados entrantes', async host => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('')); vi.stubGlobal('fetch', network)
    await worker.fetch(new Request(`https://${host}/a`, { headers: { 'X-Flow-Original-Host': 'forged.test', 'X-Flow-Client-IP': '203.0.113.1', 'X-Forwarded-Host': 'forged.test', 'X-Flow-Edge-Secret': 'forged-secret' } }), { CLOUDFLARE_EDGE_SECRET: 'worker-test-secret' })
    const upstream = network.mock.calls[0]![0] as Request
    expect(upstream.url).toBe(`https://${host}/a`); expect(upstream.redirect).toBe('manual')
    for (const name of ['X-Flow-Original-Host', 'X-Flow-Client-IP', 'X-Forwarded-Host', 'X-Flow-Edge-Secret']) expect(upstream.headers.has(name)).toBe(false)
  })
  it('Worker sin binding no reenvía peticiones de clientes', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network)
    expect((await worker.fetch(new Request('https://flow.dydasoftware.com/'), {})).status).toBe(503); expect(network).not.toHaveBeenCalled()
  })
  it('una ruta que empieza con // nunca cambia el origen ni filtra el secreto', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('')); vi.stubGlobal('fetch', network)
    await worker.fetch(new Request('https://flow.dydasoftware.com//evil.test/a'), { CLOUDFLARE_EDGE_SECRET: 'worker-test-secret' })
    expect((network.mock.calls[0]![0] as Request).url).toBe('https://app.dydasoftware.com//evil.test/a')
  })
})
