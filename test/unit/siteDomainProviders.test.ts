import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSiteDomainProvider, providerName } from '../../server/utils/siteDomains'

const keys = ['SITE_DOMAIN_PROVIDER', 'VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'RAILWAY_API_TOKEN', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID']
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of keys) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function railwayEnv() {
  process.env.RAILWAY_API_TOKEN = 'token'
  process.env.RAILWAY_PROJECT_ID = 'project'
  process.env.RAILWAY_SERVICE_ID = 'service'
  process.env.RAILWAY_ENVIRONMENT_ID = 'environment'
  delete process.env.SITE_DOMAIN_PROVIDER
  delete process.env.VERCEL_TOKEN
}

describe('proveedores de dominios de Sites', () => {
  it('selecciona proveedor explícito o detecta Vercel antes de Railway', () => {
    railwayEnv()
    process.env.VERCEL_TOKEN = 'vercel-token'
    expect(providerName()).toBe('vercel')
    process.env.SITE_DOMAIN_PROVIDER = 'railway'
    expect(providerName()).toBe('railway')
    delete process.env.VERCEL_TOKEN
    delete process.env.SITE_DOMAIN_PROVIDER
    expect(providerName()).toBe('railway')
  })

  it('falla con mensaje claro si falta configuración o el proveedor es inválido', () => {
    delete process.env.RAILWAY_API_TOKEN
    delete process.env.VERCEL_TOKEN
    delete process.env.SITE_DOMAIN_PROVIDER
    expect(() => providerName()).toThrow(/VERCEL_TOKEN o RAILWAY_API_TOKEN/)
    process.env.SITE_DOMAIN_PROVIDER = 'otro'
    expect(() => providerName()).toThrow(/debe ser vercel o railway/)
  })

  it('crea en Railway, expone DNS pendiente y consulta estado actualizado', async () => {
    railwayEnv()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { customDomainCreate: {
        id: 'domain-id', domain: 'tienda.example.com',
        status: { certificateStatus: 'PENDING', verificationToken: 'verify-token', verificationDnsHost: '_railway-verify.tienda.example.com', dnsRecords: [{ recordType: 'DNS_RECORD_TYPE_CNAME', fqdn: 'tienda.example.com', requiredValue: 'abc.up.railway.app', purpose: 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE', status: 'DNS_RECORD_STATUS_PENDING' }] }
      } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { customDomain: {
        id: 'domain-id', domain: 'tienda.example.com',
        status: { certificateStatus: 'CERTIFICATE_STATUS_TYPE_VALID', verified: true, verificationToken: 'verify-token', dnsRecords: [{ recordType: 'DNS_RECORD_TYPE_CNAME', fqdn: 'tienda.example.com', requiredValue: 'abc.up.railway.app', purpose: 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE', status: 'DNS_RECORD_STATUS_PROPAGATED' }] }
      } } })))
    vi.stubGlobal('fetch', fetchMock)
    const provider = getSiteDomainProvider('railway')
    const created = await provider.register('tienda.example.com')
    expect(provider.verified({ railway: created })).toBe(false)
    expect(provider.dns('tienda.example.com', { railway: created })).toEqual([
      { type: 'CNAME', name: 'tienda.example.com', value: 'abc.up.railway.app', purpose: 'routing' },
      { type: 'TXT', name: '_railway-verify.tienda.example.com', value: 'verify-token', purpose: 'ownership' }
    ])
    const current = await provider.status('tienda.example.com', { railway: created })
    expect(provider.verified({ railway: current })).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables.input).toEqual({ projectId: 'project', serviceId: 'service', environmentId: 'environment', domain: 'tienda.example.com' })
  })

  it('elimina en Railway y propaga errores GraphQL', async () => {
    railwayEnv()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { customDomainDelete: true } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'not authorized' }] })))
    vi.stubGlobal('fetch', fetchMock)
    const provider = getSiteDomainProvider('railway')
    await provider.remove('tienda.example.com', { railway: { id: 'domain-id' } })
    await expect(provider.register('otra.example.com')).rejects.toThrow('not authorized')
  })

  it('conserva registro y eliminación con la API REST de Vercel', async () => {
    process.env.VERCEL_TOKEN = 'vercel-token'
    process.env.VERCEL_PROJECT_ID = 'project'
    process.env.SITE_DOMAIN_PROVIDER = 'vercel'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ verified: false, verification: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const provider = getSiteDomainProvider()
    await provider.register('tienda.example.com')
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.vercel.com/v10/projects/project/domains')
    await provider.remove('tienda.example.com')
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })
})
