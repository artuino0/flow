import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rows: [] as unknown[][], saved: undefined as Record<string, unknown> | undefined, insert: vi.fn(), update: vi.fn() }))
vi.mock('../../server/db', () => ({
  db: {},
  withTenant: async (_tenant: string, callback: (tx: unknown) => unknown) => {
    const select = () => {
      const rows = fixture.rows.shift() ?? []
      const chain = { from: () => chain, where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }
      return chain
    }
    const write = (value: Record<string, unknown>) => {
      fixture.saved = value
      const chain = { where: () => chain, returning: async () => [{ id: 'domain-id', hostname: 'tienda.example.com', ...value }] }
      return chain
    }
    return callback({ select, insert: () => { fixture.insert(); return { values: write } }, update: () => { fixture.update(); return { set: write } } })
  }
}))
import { createSiteDomain, verifySiteDomain } from '../../server/utils/siteDomains'

beforeEach(() => {
  fixture.rows = [[{ id: 'site' }], [], [{ count: 0 }]]
  fixture.saved = undefined
  fixture.insert.mockClear(); fixture.update.mockClear()
  vi.stubEnv('SITE_DOMAIN_PROVIDER', 'railway')
  for (const key of ['API_TOKEN', 'PROJECT_ID', 'SERVICE_ID', 'ENVIRONMENT_ID']) vi.stubEnv(`RAILWAY_${key}`, 'simulated')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Respuesta simulada no configurada') }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const routing = { recordType: 'DNS_RECORD_TYPE_CNAME', fqdn: 'tienda.example.com', requiredValue: 'simulated.up.railway.app', purpose: 'TRAFFIC_ROUTE', status: 'PROPAGATED' }
const cases = [
  { label: 'DNS pendiente', status: { verified: false, certificateStatus: 'PENDING', verificationToken: 'token', dnsRecords: [{ ...routing, status: 'PENDING' }] }, active: false },
  { label: 'certificado emitido', status: { verified: true, certificateStatus: 'ISSUED', dnsRecords: [routing] }, active: true },
  { label: 'certificado pendiente con DNS verificado', status: { verified: true, certificateStatus: 'PENDING', dnsRecords: [routing] }, active: false },
  { label: 'certificado con error y motivo', status: { verified: true, certificateStatus: 'ERROR', certificateErrorMessage: 'CAA impide emitir el certificado', dnsRecords: [routing] }, active: false },
  { label: 'status nulo', status: null, active: false },
  { label: 'certificado ausente y DNS propagado (compatibilidad)', status: { dnsRecords: [routing] }, active: true }
]

describe('persistencia Railway sin red ni base real', () => {
  it.each(cases)('guarda alta y verificación: $label', async ({ status, active }) => {
    const domain = { id: 'domain-id', status }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { customDomainCreate: domain, customDomain: domain } })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createSiteDomain('tenant', 'user', { siteId: 'site', hostname: 'tienda.example.com' })
    expect(result).toMatchObject({ status: active ? 'active' : 'pending' })
    expect(result?.ownershipVerified).toBe(active)
    expect(fixture.insert).toHaveBeenCalledOnce()
    expect((fixture.saved?.providerData as Record<string, unknown>).railway).toEqual(domain)
    if (status?.verificationToken) expect(result?.dnsRecords).toEqual([
      { type: 'CNAME', name: 'tienda.example.com', value: 'simulated.up.railway.app', purpose: 'routing' },
      { type: 'TXT', name: '_railway-verify.tienda.example.com', value: 'token', purpose: 'ownership' }
    ])
    if (status === null) expect(result?.dnsRecords).toEqual([])
    fixture.rows = [[{ id: 'domain-id', hostname: 'tienda.example.com', provider: 'railway', providerData: { railway: domain } }]]
    const updated = await verifySiteDomain('tenant', 'domain-id')
    expect(updated).toMatchObject({ status: active ? 'active' : 'pending' })
    expect(updated?.dnsRecords).toEqual(result?.dnsRecords)
    expect(fixture.update).toHaveBeenCalledOnce()
  })

  it.each([
    { errors: [{ message: 'Cannot query field "verified" on type "CustomDomain".' }] },
    { errors: [{ message: 'Esquema incompatible', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] }
  ])('oculta errores de esquema, conserva el registro original y no inserta', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createSiteDomain('tenant', 'user', { siteId: 'site', hostname: 'tienda.example.com' })).rejects.toMatchObject({ statusCode: 502, statusMessage: 'No pudimos registrar el dominio con el proveedor. Inténtalo más tarde o contacta a soporte.' })
    expect(logger).toHaveBeenCalledWith('[Sites Railway] Error de validación GraphQL:', body.errors[0]!.message)
    expect(fixture.insert).not.toHaveBeenCalled()
    fixture.rows = [[{ id: 'domain-id', hostname: 'tienda.example.com', provider: 'railway', providerData: { railway: { id: 'domain-id' } } }]]
    await verifySiteDomain('tenant', 'domain-id')
    expect((fixture.saved?.providerData as Record<string, unknown>).providerError).toBe('No pudimos registrar el dominio con el proveedor. Inténtalo más tarde o contacta a soporte.')
  })

  it.each([
    { body: { errors: [{ message: 'not authorized' }] }, status: 200, message: 'not authorized' },
    { body: {}, status: 503, message: 'Railway respondió 503' },
    { body: { data: {} }, status: 200, message: 'Railway no devolvió el dominio creado' }
  ])('no inserta si el alta falla: $message', async ({ body, status, message }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
    await expect(createSiteDomain('tenant', 'user', { siteId: 'site', hostname: 'tienda.example.com' })).rejects.toThrow(message)
    expect(fixture.insert).not.toHaveBeenCalled()
  })
})
