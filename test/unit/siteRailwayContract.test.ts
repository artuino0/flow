import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { getSiteDomainProvider } from '../../server/utils/siteDomains'

// Esquema proporcionado por la tarea (introspección del 2026-10-04); sin red.
const fields = {
  CustomDomain: ['createdAt', 'deletedAt', 'domain', 'edgeId', 'environmentId', 'id', 'isRailwayDomain', 'projectId', 'serviceId', 'status', 'syncStatus', 'targetPort', 'updatedAt'],
  CustomDomainStatus: ['cdnProvider', 'certificateErrorMessage', 'certificateErrorType', 'certificateRetryable', 'certificateStatus', 'certificateStatusDetailed', 'certificates', 'dnsRecords', 'verificationDnsHost', 'verificationToken', 'verified'],
  DNSRecords: ['currentValue', 'fqdn', 'hostlabel', 'purpose', 'recordType', 'requiredValue', 'status', 'zone']
}
type SchemaType = keyof typeof fields

function validateSelection(query: string) {
  const tokens: string[] = [...(query.match(/[A-Za-z_][A-Za-z_0-9]*|[{}()$!:]/g) ?? [])]
  let index = tokens.indexOf('{') + 1
  function selection(type?: SchemaType) {
    while (index < tokens.length && tokens[index] !== '}') {
      const field = tokens[index++]!
      if (type) expect(fields[type], `${type}.${field}`).toContain(field)
      if (tokens[index] === '(') {
        let depth = 0
        do {
          const token = tokens[index++]
          if (token === '(') depth++
          if (token === ')') depth--
        } while (depth > 0 && index < tokens.length)
      }
      if (tokens[index] === '{') {
        index++
        const child = !type ? 'CustomDomain' : type === 'CustomDomain' && field === 'status'
          ? 'CustomDomainStatus' : type === 'CustomDomainStatus' && field === 'dnsRecords' ? 'DNSRecords' : undefined
        expect(child, `Selección desconocida: ${field}`).toBeDefined()
        selection(child)
      }
    }
    expect(tokens[index++]).toBe('}')
  }
  selection()
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('valida todas las operaciones Railway emitidas contra las listas del esquema', async () => {
  for (const key of ['API_TOKEN', 'PROJECT_ID', 'SERVICE_ID', 'ENVIRONMENT_ID']) vi.stubEnv(`RAILWAY_${key}`, 'simulated')
  const queries: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string }
    queries.push(query)
    return new Response(JSON.stringify({ data: { customDomainCreate: { id: 'simulated' }, customDomain: { id: 'simulated' }, customDomainDelete: true } }))
  }))
  const provider = getSiteDomainProvider('railway')
  await provider.register('tienda.example.com')
  await provider.status('tienda.example.com', { railway: { id: 'simulated' } })
  await provider.status('tienda.example.com')
  await provider.remove('tienda.example.com', { railway: { id: 'simulated' } })
  const source = readFileSync(new URL('../../server/utils/siteDomains.ts', import.meta.url), 'utf8')
  const declared = [...source.matchAll(/railwayRequest\((?:`|')(query|mutation)\s+(\w+)/g)].map(match => match[2])
  const emitted = queries.map(query => query.match(/^(?:query|mutation)\s+(\w+)/)?.[1])
  expect([...new Set(emitted)].sort()).toEqual([...new Set(declared)].sort())
  expect(declared).toEqual(['customDomain', 'customDomainCreate', 'customDomainDelete'])
  for (const query of queries) validateSelection(query)
})

it('rechaza campos inválidos incluso si aparecen dentro de una selección anidada', () => {
  expect(() => validateSelection('query example { customDomain { verified } }')).toThrow('CustomDomain.verified')
  expect(() => validateSelection('query example { customDomain { status { dnsRecords { invented } } } }')).toThrow('DNSRecords.invented')
})
