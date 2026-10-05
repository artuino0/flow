import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
const fixture = vi.hoisted(() => ({ resolve4: vi.fn(), resolve6: vi.fn(), rows: [] as unknown[][], insert: vi.fn() }))
vi.mock('node:dns', () => ({ promises: { resolve4: fixture.resolve4, resolve6: fixture.resolve6 } }))
vi.mock('../../server/db', () => ({ db: {}, withTenant: async (_tenant: string, callback: (tx: unknown) => unknown) => {
  const select = () => { const rows = fixture.rows.shift() ?? []; const chain = { from: () => chain, where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }; return chain }
  return callback({ select, insert: () => { fixture.insert(); return { values: (value: Record<string, unknown>) => ({ returning: async () => [{ id: 'domain', ...value }] }) } } })
} }))
import { isCloudflareAddress, isCloudflareOwnZoneHostname } from '../../server/utils/cloudflareOwnZone'
import { createSiteDomain, getSiteDomainProvider } from '../../server/utils/siteDomains'
import { captureEdgeHost } from '../../server/utils/effectiveHost'
import proofHandler from '../../server/routes/.well-known/flow-site-edge.get'

beforeEach(() => {
  vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('APP_BASE_URL', 'https://app.dydasoftware.com')
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'mock-token'); vi.stubEnv('CLOUDFLARE_ZONE_ID', 'zone')
  vi.stubEnv('CLOUDFLARE_CNAME_TARGET', 'customers.dydasoftware.com'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'mock-edge')
  vi.stubEnv('CLOUDFLARE_FALLBACK_ORIGIN', 'app.dydasoftware.com'); vi.stubEnv('CLOUDFLARE_ZONE_NAME', 'dydasoftware.com')
  vi.stubEnv('CLOUDFLARE_OWN_ZONE_HOSTNAMES', '')
  fixture.rows = [[{ id: 'site' }], [], [{ count: 0 }]]; fixture.insert.mockClear()
  fixture.resolve4.mockReset().mockResolvedValue(['104.16.0.1']); fixture.resolve6.mockReset().mockResolvedValue([])
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input))
    if (url.hostname === 'api.cloudflare.com') throw new Error('La zona propia no debe llamar Custom Hostnames')
    return new Response(JSON.stringify({ edge: true, hostname: url.hostname, nonce: url.searchParams.get('nonce') }), { headers: { 'cf-ray': 'mock-ray' } })
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('zona propia y dominio de app separado, completamente simulado', () => {
  it('sufijo delimitado o lista explícita distinguen zona y terceros', () => {
    expect(isCloudflareOwnZoneHostname('flow.dydasoftware.com')).toBe(true)
    expect(isCloudflareOwnZoneHostname('dydasoftware.com')).toBe(true)
    expect(isCloudflareOwnZoneHostname('falsodydasoftware.com')).toBe(false)
    expect(isCloudflareOwnZoneHostname('dydasoftware.com.ajeno.test')).toBe(false)
    vi.stubEnv('CLOUDFLARE_OWN_ZONE_HOSTNAMES', 'flow.dydasoftware.com,dydasoftware.com,www.dydasoftware.com')
    expect(isCloudflareOwnZoneHostname('otro.dydasoftware.com')).toBe(false)
    expect(isCloudflareOwnZoneHostname('www.dydasoftware.com')).toBe(true)
  })
  it.each(['flow.dydasoftware.com', 'dydasoftware.com', 'www.dydasoftware.com'])('register devuelve gestión por zona, DNS y prueba; verified exige ambos: %s', async hostname => {
    const provider = getSiteDomainProvider(), data = await provider.register(hostname)
    expect(data).toMatchObject({ hostname, managedByZone: true, managementReason: 'own_zone', dnsVerified: true, edgeVerified: true, status: 'active' })
    expect(data).not.toHaveProperty('id')
    expect(data.dnsRecords).toEqual(provider.dns(hostname, { cloudflare: data }))
    expect(provider.dns(hostname, { cloudflare: data })).toEqual([{ type: 'CNAME', name: hostname === 'dydasoftware.com' ? '@' : hostname, value: 'app.dydasoftware.com', purpose: 'routing' }])
    expect(provider.verified({ cloudflare: data })).toBe(true)
    expect(provider.verified({ cloudflare: { ...data, dnsVerified: false } })).toBe(false)
    expect(provider.verified({ cloudflare: { ...data, edgeVerified: false } })).toBe(false)
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/(?:flow\.|www\.)?dydasoftware\.com\/\.well-known\/flow-site-edge\?nonce=/), expect.objectContaining({ redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal) }))
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toMatch(/mock-token|mock-edge|authorization/)
    await provider.status(hostname, { cloudflare: data })
    vi.mocked(fetch).mockClear(); await provider.remove(hostname, { cloudflare: data }); expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv('CLOUDFLARE_ZONE_NAME', ''); await provider.remove(hostname, { cloudflare: data }); expect(fetch).not.toHaveBeenCalled()
  })
  it('tercero sí utiliza POST de Custom Hostnames', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, result: { id: 'id', hostname: 'cliente.test', status: 'pending' } }))))
    expect(await getSiteDomainProvider().register('cliente.test')).toMatchObject({ id: 'id' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api.cloudflare.com'), expect.objectContaining({ method: 'POST' }))
    expect(fixture.resolve4).not.toHaveBeenCalled()
  })
  it.each(['flow.dydasoftware.com', 'dydasoftware.com', 'www.dydasoftware.com'])('persiste asignación propia %s sin alta remota', async hostname => {
    const result = await createSiteDomain('tenant', 'user', { siteId: 'site', hostname })
    expect(result).toMatchObject({ status: 'active', managedByZone: true }); expect(fixture.insert).toHaveBeenCalledOnce()
  })
  it.each(['app.dydasoftware.com', 'customers.dydasoftware.com'])('rechaza host reservado %s antes de red e INSERT', async hostname => {
    await expect(createSiteDomain('tenant', 'user', { siteId: 'site', hostname })).rejects.toMatchObject({ statusCode: 422, statusMessage: expect.stringContaining('reservado') })
    expect(fetch).not.toHaveBeenCalled(); expect(fixture.insert).not.toHaveBeenCalled()
  })
  it('DNS no Cloudflare falla cerrado, incluido privado e IPv6', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '8.8.8.8', '::1']) expect(isCloudflareAddress(address)).toBe(false)
    expect(isCloudflareAddress('2606:4700::1111')).toBe(true)
    fixture.resolve4.mockResolvedValue(['127.0.0.1'])
    const data = await getSiteDomainProvider().register('flow.dydasoftware.com')
    expect(data.status).toBe('pending'); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['redirect', 'missing-cf-ray', 'wrong-host', 'wrong-nonce', 'no-edge', 'invalid-json', 'oversized'])('HTTP no prueba borde: %s', async mode => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input))
      if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'https://ajeno.test', 'cf-ray': 'mock' } })
      return new Response(mode === 'invalid-json' ? 'html' : mode === 'oversized' ? 'x'.repeat(5000) : JSON.stringify({ edge: mode !== 'no-edge', hostname: mode === 'wrong-host' ? 'app.dydasoftware.com' : url.hostname, nonce: mode === 'wrong-nonce' ? 'otro' : url.searchParams.get('nonce') }), { headers: mode === 'missing-cf-ray' ? {} : { 'cf-ray': 'mock' } })
    }))
    const provider = getSiteDomainProvider(), data = await provider.register('flow.dydasoftware.com')
    expect(data.status).toBe('pending'); expect(provider.verified({ cloudflare: data })).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('timeout DNS acotado no dispara HTTP', async () => {
    vi.useFakeTimers(); fixture.resolve4.mockImplementation(() => new Promise(() => {})); fixture.resolve6.mockImplementation(() => new Promise(() => {}))
    const pending = getSiteDomainProvider().register('flow.dydasoftware.com')
    await vi.advanceTimersByTimeAsync(2001)
    expect((await pending).status).toBe('pending'); expect(fetch).not.toHaveBeenCalled()
  })
  it('fallo/timeout HTTPS conserva pendiente sin revelar excepción', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('Timeout con detalle privado') }))
    const data = await getSiteDomainProvider().register('flow.dydasoftware.com')
    expect(data.status).toBe('pending'); expect(JSON.stringify(data)).not.toContain('privado')
  })
  it('endpoint prueba host autenticado y nonce sin secreto; directo devuelve 404', async () => {
    const nonce = '01234567-0123-0123-0123-012345678901'
    const request = (secret: string) => {
      const req = new IncomingMessage(new Socket()); req.url = `/.well-known/flow-site-edge?nonce=${nonce}`; req.method = 'GET'
      req.headers = { host: 'app.dydasoftware.com', 'x-forwarded-host': 'flow.dydasoftware.com', 'x-flow-edge-secret': secret }
      const event = createEvent(req, new ServerResponse(req)); captureEdgeHost(event); return event
    }
    const event = request('mock-edge')
    expect(await proofHandler(event)).toEqual({ edge: true, hostname: 'flow.dydasoftware.com', nonce })
    expect(event.node.res.getHeader('cache-control')).toBe('no-store')
    expect(() => proofHandler(request('incorrecto'))).toThrow(expect.objectContaining({ statusCode: 404 }))
  })
  it('sondeo completo usa prueba del Worker y rechaza el host de origen, sin red real', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input))
      const req = new IncomingMessage(new Socket()); req.url = url.pathname + url.search; req.method = 'GET'
      req.headers = { host: 'app.dydasoftware.com', 'x-forwarded-host': 'app.dydasoftware.com', 'x-flow-original-host': url.host, 'x-flow-client-ip': '198.51.100.185', 'x-flow-edge-secret': 'mock-edge' }
      const event = createEvent(req, new ServerResponse(req)); captureEdgeHost(event)
      const proof = await proofHandler(event)
      expect(req.headers['x-flow-original-host']).toBeUndefined(); expect(req.headers['x-flow-client-ip']).toBeUndefined()
      return new Response(JSON.stringify(proof), { headers: { 'cf-ray': 'mock-ray' } })
    }))
    const provider = getSiteDomainProvider()
    expect(provider.verified({ cloudflare: await provider.register('flow.dydasoftware.com') })).toBe(true)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input))
      return new Response(JSON.stringify({ edge: true, hostname: 'app.dydasoftware.com', nonce: url.searchParams.get('nonce') }), { headers: { 'cf-ray': 'mock-ray' } })
    }))
    expect(provider.verified({ cloudflare: await provider.register('flow.dydasoftware.com') })).toBe(false)
  })
})
