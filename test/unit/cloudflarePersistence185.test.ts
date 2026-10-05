import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ rows: [] as unknown[][], saved: undefined as Record<string, unknown> | undefined, insert: vi.fn(), remove: vi.fn() }))
vi.mock('../../server/db', () => ({ db: {}, withTenant: async (_tenant: string, callback: (tx: unknown) => unknown) => {
  const select = () => { const rows = fixture.rows.shift() ?? []; const chain = { from: () => chain, where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }; return chain }
  const write = (value: Record<string, unknown>) => { fixture.saved = value; const chain = { where: () => chain, returning: async () => [{ id: 'domain', hostname: 'www.cliente.test', ...value }] }; return chain }
  return callback({ select, insert: () => { fixture.insert(); return { values: write } }, update: () => ({ set: write }), delete: () => { fixture.remove(); return { where: () => ({ returning: async () => [{ id: 'domain' }] }) } } })
} }))
import { createSiteDomain, deleteSiteDomain, verifySiteDomain } from '../../server/utils/siteDomains'
beforeEach(() => {
  fixture.rows = [[{ id: 'site' }], [], [{ count: 0 }]]; fixture.saved = undefined; fixture.insert.mockClear(); fixture.remove.mockClear()
  vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare')
  for (const key of ['API_TOKEN', 'ZONE_ID', 'CNAME_TARGET', 'EDGE_SECRET']) vi.stubEnv(`CLOUDFLARE_${key}`, 'simulated')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Simulación obligatoria') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it.each([400, 409, 429, 401, 403, 500, 503])('alta fallida %s nunca inserta', async status => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'internal' }] }), { status })))
  await expect(createSiteDomain('tenant', 'user', { siteId: 'site', hostname: 'www.cliente.test' })).rejects.toMatchObject({ statusCode: 502 })
  expect(fixture.insert).not.toHaveBeenCalled()
})
it.each(['pending', 'active'])('guarda id y exige certificado activo: %s', async status => {
  const result = { id: 'cf-id', hostname: 'www.cliente.test', status, ssl: { status } }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, result }))))
  const created = await createSiteDomain('tenant', 'user', { siteId: 'site', hostname: 'www.cliente.test' })
  expect(created).toMatchObject({ status }); expect(fixture.insert).toHaveBeenCalledOnce()
  expect((fixture.saved?.providerData as Record<string, unknown>).cloudflare).toEqual(result)
  fixture.rows = [[{ id: 'domain', hostname: 'www.cliente.test', provider: 'cloudflare', providerData: { cloudflare: result } }]]
  const current = await verifySiteDomain('tenant', 'domain')
  expect(current).toMatchObject({ status }); expect(current?.certificateVerified).toBe(status === 'active')
})
it('baja remota fallida conserva fila local; 404 permite borrarla', async () => {
  const rows = () => [[{ hostname: 'www.cliente.test' }], [{ provider: 'cloudflare', providerData: { cloudflare: { id: 'cf-id' } } }]]
  fixture.rows = rows()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: false }), { status: 503 })))
  await expect(deleteSiteDomain('tenant', 'domain')).rejects.toMatchObject({ statusCode: 502 })
  expect(fixture.remove).not.toHaveBeenCalled()
  fixture.rows = rows()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('', { status: 404 })))
  expect(await deleteSiteDomain('tenant', 'domain')).toBe(true); expect(fixture.remove).toHaveBeenCalledOnce()
})
