import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSiteDomainProvider, providerName } from '../../server/utils/siteDomains'
import { cloudflarePresentation } from '../../server/utils/cloudflareSiteDomains'

const hostname = 'www.cliente.test'
const pending = { id: 'cf-id', hostname, status: 'pending', ssl: { status: 'pending_validation', method: 'http', type: 'dv', settings: { min_tls_version: '1.2', early_hints: 'on' }, validation_records: [{ txt_name: '_acme-challenge.www.cliente.test', txt_value: 'dcv-token' }] }, ownership_verification: { type: 'txt', name: '_cf-custom-hostname.www.cliente.test', value: 'ownership-token' } }
const reply = (result: unknown, status = 200, success = true) => new Response(JSON.stringify({ success, result, errors: success ? [] : [{ code: 1000, message: 'Detalles internos del proveedor' }] }), { status })
beforeEach(() => {
  vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare')
  for (const key of ['API_TOKEN', 'ZONE_ID', 'CNAME_TARGET', 'EDGE_SECRET']) vi.stubEnv(`CLOUDFLARE_${key}`, key === 'CNAME_TARGET' ? 'customers.flow.test' : 'simulated-' + key)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Solo respuestas simuladas') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Cloudflare Custom Hostnames con red simulada', () => {
  it('alta pendiente con contrato exacto, id guardable y todos los TXT', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply(pending)); vi.stubGlobal('fetch', fetcher)
    expect(providerName()).toBe('cloudflare')
    const provider = getSiteDomainProvider(), result = await provider.register(hostname)
    expect(result.id).toBe('cf-id'); expect(provider.verified({ cloudflare: result })).toBe(false)
    expect(fetcher.mock.calls[0]).toEqual(['https://api.cloudflare.com/client/v4/zones/simulated-ZONE_ID/custom_hostnames', {
      method: 'POST', headers: { authorization: 'Bearer simulated-API_TOKEN', 'content-type': 'application/json' }, body: JSON.stringify({ hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } })
    }])
    expect(provider.dns(hostname, { cloudflare: result })).toEqual([
      { type: 'CNAME', name: hostname, value: 'customers.flow.test', purpose: 'routing' },
      { type: 'TXT', name: pending.ownership_verification.name, value: 'ownership-token', purpose: 'ownership' },
      { type: 'TXT', name: pending.ssl.validation_records[0]!.txt_name, value: 'dcv-token', purpose: 'ownership' }
    ])
    expect(provider.dns('cliente.test')[0]).toEqual({ type: 'CNAME', name: 'cliente.test', value: 'customers.flow.test', purpose: 'routing' })
  })
  it.each(['API_TOKEN', 'ZONE_ID', 'CNAME_TARGET', 'EDGE_SECRET'])('sin %s no llama red, 503 seguro', async key => {
    vi.stubEnv(`CLOUDFLARE_${key}`, '')
    const provider = getSiteDomainProvider()
    expect(provider.configured).toBe(false)
    await expect(provider.register(hostname)).rejects.toMatchObject({ statusCode: 503, statusMessage: expect.not.stringContaining('CLOUDFLARE') })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    { status: 'pending', ssl: { status: 'active' }, verified: false, state: 'dns' },
    { status: 'active', ssl: { status: 'pending_issuance' }, verified: false, state: 'certificate' },
    { status: 'active', ssl: { status: 'active' }, verified: true, state: 'active' },
    { status: 'active', ssl: null, verified: false, state: 'certificate' },
    { status: 'pending', ssl: { status: 'pending_validation', validation_errors: [{ message: 'CAA rejects INTERNAL_SECRET' }] }, verified: false, state: 'error' }
  ])('activa únicamente hostname y certificado activos: $state', ({ status, ssl, verified, state }) => {
    const data = { cloudflare: { id: 'id', status, ssl } }
    expect(getSiteDomainProvider().verified(data)).toBe(verified)
    expect(cloudflarePresentation(data).verificationState).toBe(state)
    expect(JSON.stringify(cloudflarePresentation(data))).not.toContain('INTERNAL_SECRET')
  })
  it('consulta y reintenta DCV preservando method/type/settings del GET', async () => {
    const fetcher = vi.fn().mockImplementationOnce(async () => reply(pending)).mockImplementationOnce(async () => reply({ ...pending, status: 'active', ssl: { ...pending.ssl, status: 'active' } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await getSiteDomainProvider().status(hostname, { cloudflare: { id: 'cf-id' } })
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['GET', 'PATCH'])
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ ssl: { method: 'http', type: 'dv', settings: pending.ssl.settings } })
    expect(getSiteDomainProvider().verified({ cloudflare: result })).toBe(true)
  })
  it('status sin id busca por nombre, sin crear remoto nuevo', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply([{ id: 'cf-id', hostname, status: 'active', ssl: { status: 'active' } }]))
    vi.stubGlobal('fetch', fetcher)
    expect((await getSiteDomainProvider().status(hostname)).id).toBe('cf-id')
    expect(fetcher.mock.calls[0]).toEqual([expect.stringContaining('?hostname=www.cliente.test'), expect.objectContaining({ method: 'GET' })])
  })
  it.each([400, 409, 429, 401, 403, 500, 503])('duplicado/otra zona/límite/token/servidor (%s): error seguro y detalle interno', async status => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => reply(null, status, false)))
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(getSiteDomainProvider().register(hostname)).rejects.toMatchObject({ statusCode: 502, statusMessage: 'No pudimos registrar el dominio con el proveedor. Inténtalo más tarde o contacta a soporte.' })
    expect(logger).toHaveBeenCalledWith('[Sites Cloudflare] Error del proveedor:', status, expect.stringContaining('Detalles internos'))
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each([null, {}, { hostname }, { id: 'id', hostname: 'ajeno.test' }])('respuesta sin id o ajena se controla: %j', async result => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => reply(result)))
    await expect(getSiteDomainProvider().register(hostname)).rejects.toMatchObject({ statusCode: 502 })
  })
  it('respuesta con id sin campos opcionales permanece pendiente sin excepción', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => reply({ id: 'id' })))
    const provider = getSiteDomainProvider(), result = await provider.register(hostname)
    expect(provider.verified({ cloudflare: result })).toBe(false)
    expect(provider.dns(hostname, { cloudflare: result })).toHaveLength(1)
  })
  it('baja idempotente 404 y búsqueda sin id', async () => {
    const fetcher = vi.fn().mockImplementationOnce(async () => reply(null, 404, false)).mockImplementationOnce(async () => reply([{ id: 'found-id', hostname }])).mockImplementationOnce(async () => reply({ id: 'found-id' }))
    vi.stubGlobal('fetch', fetcher)
    const provider = getSiteDomainProvider()
    await provider.remove(hostname, { cloudflare: { id: 'cf-id' } }); await provider.remove(hostname)
    expect(fetcher.mock.calls.map(call => [call[0], call[1].method])).toEqual([
      [expect.stringContaining('/cf-id'), 'DELETE'], [expect.stringContaining('?hostname='), 'GET'], [expect.stringContaining('/found-id'), 'DELETE']
    ])
  })
  it('baja ausente por búsqueda no borra; respuesta inválida/red fallan seguros', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => reply([])))
    await getSiteDomainProvider().remove(hostname); expect(fetch).toHaveBeenCalledOnce()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('no-json')))
    await expect(getSiteDomainProvider().register(hostname)).rejects.toMatchObject({ statusCode: 502 })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('red interna') }))
    await expect(getSiteDomainProvider().register(hostname)).rejects.toMatchObject({ statusCode: 502 })
  })
})
