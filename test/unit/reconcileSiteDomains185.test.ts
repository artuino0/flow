import { describe, expect, it, vi } from 'vitest'
import { reconciliationOptions, reconciliationReport, reconcileSiteDomains, remoteAdapter } from '../../scripts/reconcileSiteDomains.mjs'

describe('conciliación solo con proveedores y base simulados', () => {
  const local = [{ hostname: 'usado.test', provider: 'cloudflare' }, { hostname: 'migrado.test', provider: 'railway' }, { hostname: 'sin-remoto.test', provider: 'cloudflare' }]
  const rows = [{ id: '1', hostname: 'usado.test' }, { id: '2', hostname: 'migrado.test' }, { id: '3', hostname: 'huerfano.test' }, { id: '4', hostname: 'otro.test' }]
  it('inventario distingue migraciones, ausencias y duplicados', () => {
    expect(reconciliationReport([...local, local[0]], [...rows, rows[0]], 'cloudflare')).toEqual({ provider: 'cloudflare', localWithoutRemote: ['sin-remoto.test'], remoteWithoutLocal: ['huerfano.test', 'otro.test'], duplicateLocal: ['usado.test'], duplicateRemote: ['usado.test'] })
  })
  it('zona propia gestionada no se marca como remoto faltante', () => {
    const report = reconciliationReport([{ hostname: 'flow.dydasoftware.com', provider: 'cloudflare', providerData: { cloudflare: { managedByZone: true } } }], [], 'cloudflare')
    expect(report.localWithoutRemote).toEqual([]); expect(report.remoteWithoutLocal).toEqual([])
  })
  it('por omisión no borra; apply solo elimina el nombre confirmado', async () => {
    const remote = { provider: 'cloudflare', list: vi.fn(async () => rows), remove: vi.fn() }, readLocal = vi.fn(async () => local)
    await reconcileSiteDomains({ readLocal, remote, output: vi.fn() }); expect(remote.remove).not.toHaveBeenCalled()
    await reconcileSiteDomains({ args: ['--apply', '--only', 'huerfano.test'], readLocal, remote, output: vi.fn() })
    expect(remote.remove).toHaveBeenCalledExactlyOnceWith(rows[2]); expect(remote.remove).not.toHaveBeenCalledWith(rows[3])
  })
  it.each([['--apply'], ['--only', 'huerfano.test'], ['--apply', '--only', '*'], ['--apply', '--only', 'huerfano.test', 'otro.test']].map(args => ({ args })))('opciones inseguras fallan antes de consultar: $args', ({ args }) => {
    expect(() => reconciliationOptions(args)).toThrow()
  })
  it('no borra asociado/duplicado ni nombre recién asociado', async () => {
    const remote = { provider: 'cloudflare', list: async () => rows, remove: vi.fn() }
    await expect(reconcileSiteDomains({ args: ['--apply', '--only', 'usado.test'], readLocal: async () => local, remote, output: vi.fn() })).rejects.toThrow('huérfano')
    const readLocal = vi.fn().mockResolvedValueOnce(local).mockResolvedValueOnce([...local, { hostname: 'huerfano.test', provider: 'railway' }])
    await expect(reconcileSiteDomains({ args: ['--apply', '--only', 'huerfano.test'], readLocal, remote, output: vi.fn() })).rejects.toThrow('fila local')
    expect(remote.remove).not.toHaveBeenCalled()
  })
  it('protege app/fallback aun sin fila local', async () => {
    const remote = { provider: 'railway', protectedHostnames: ['app.dydasoftware.com'], list: async () => [{ id: 'app-id', hostname: 'app.dydasoftware.com' }], remove: vi.fn() }
    await expect(reconcileSiteDomains({ args: ['--apply', '--only', 'app.dydasoftware.com'], readLocal: async () => [], remote, output: vi.fn() })).rejects.toThrow('reservado')
    expect(remote.remove).not.toHaveBeenCalled()
  })
  it('Cloudflare pagina antes de conciliar y borra id exacto; 404 idempotente', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(JSON.stringify({ success: true, result: [rows[0]], result_info: { total_pages: 2 } }))).mockImplementationOnce(async () => new Response(JSON.stringify({ success: true, result: [rows[2]], result_info: { total_pages: 2 } }))).mockImplementationOnce(async () => new Response('', { status: 404 }))
    const adapter = remoteAdapter({ SITE_DOMAIN_PROVIDER: 'cloudflare', CLOUDFLARE_API_TOKEN: 'mock-token', CLOUDFLARE_ZONE_ID: 'zone' }, fetcher)
    expect(await adapter.list()).toEqual([rows[0], rows[2]])
    await adapter.remove(rows[2])
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([expect.stringContaining('page=1'), expect.stringContaining('page=2'), expect.stringContaining('/3')])
  })
  it('Railway lista domains/customDomains sin incluir dominio automático', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(JSON.stringify({ data: { domains: { customDomains: [{ id: 'railway-id', domain: 'getkountly.com' }] } } }))).mockImplementationOnce(async () => new Response(JSON.stringify({ data: { customDomainDelete: true } })))
    const adapter = remoteAdapter({ SITE_DOMAIN_PROVIDER: 'railway', RAILWAY_API_TOKEN: 'mock-token', RAILWAY_SERVICE_ID: 'service', RAILWAY_ENVIRONMENT_ID: 'env' }, fetcher)
    const remote = await adapter.list(); expect(remote).toEqual([{ id: 'railway-id', hostname: 'getkountly.com' }])
    await adapter.remove(remote[0]); expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).variables.id).toBe('railway-id')
  })
})
