import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { captureEdgeHost, effectiveRequestHost, effectiveRequestHostname, effectiveRequestURL } from '../../server/utils/effectiveHost'
import { allowedRequestOrigins } from '../../server/utils/requestOrigin'

export function edgeEvent(secret?: string, forwarded = 'www.cliente.test', host = 'origin.flow.test') {
  const request = new IncomingMessage(new Socket()); request.url = '/servicios?x=1'; request.headers = { host, 'x-forwarded-host': forwarded, 'x-forwarded-proto': 'https', ...(secret ? { 'x-flow-edge-secret': secret } : {}) }
  return createEvent(request, new ServerResponse(request))
}
beforeEach(() => { vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge'); vi.stubEnv('APP_BASE_URL', 'https://app.flow.test'); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'origin.flow.test') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('host efectivo autenticado, sin llamadas de red', () => {
  it.each([undefined, 'incorrecto', 'simulated-edgf', 'simulated-edge-extra'])('sin secreto válido (%s) ignora suplantación', secret => {
    const event = edgeEvent(secret)
    expect(effectiveRequestHostname(event)).toBe('origin.flow.test')
    expect(allowedRequestOrigins(event)).not.toContain('https://www.cliente.test')
    captureEdgeHost(event)
    expect(effectiveRequestHost(event)).toBe('origin.flow.test')
    expect(event.node.req.headers['x-flow-edge-secret']).toBeUndefined()
    expect(event.node.req.headers['x-forwarded-host']).toBeUndefined()
  })
  it('secreto correcto autentica host y sobrevive a retirar cabeceras privadas', () => {
    const event = edgeEvent('simulated-edge')
    expect(effectiveRequestURL(event).origin).toBe('https://www.cliente.test')
    captureEdgeHost(event); captureEdgeHost(event)
    expect(effectiveRequestHost(event, false)).toBe('www.cliente.test')
    expect(effectiveRequestURL(event).href).toBe('https://www.cliente.test/servicios?x=1')
    expect(event.node.req.headers).not.toHaveProperty('x-flow-edge-secret')
    expect(event.node.req.headers).not.toHaveProperty('x-forwarded-host')
    expect(JSON.stringify(event.context)).not.toContain('simulated-edge')
  })
  it('secreto no configurado nunca confía; conserva puerto local y normaliza hostname', () => {
    vi.stubEnv('CLOUDFLARE_EDGE_SECRET', '')
    expect(effectiveRequestHost(edgeEvent('simulated-edge', 'ajeno.test', 'localhost:3000'))).toBe('localhost:3000')
    vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge')
    expect(effectiveRequestHostname(edgeEvent('simulated-edge', 'WWW.Cliente.Test.'))).toBe('www.cliente.test')
  })
  it.each(['https://evil.test', 'evil.test/path', 'user@evil.test', 'invalid host'])('autoridad reenviada inválida se rechaza: %s', host => {
    expect(effectiveRequestHost(edgeEvent('simulated-edge', host))).toBe('')
  })
  it.each(['railway', 'vercel'])('conserva lectura antigua según consumidor para %s', provider => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', provider)
    const event = edgeEvent()
    expect(effectiveRequestHost(event)).toBe('www.cliente.test')
    expect(effectiveRequestHost(event, false)).toBe('origin.flow.test')
    captureEdgeHost(event)
    expect(event.node.req.headers['x-forwarded-host']).toBe('www.cliente.test')
  })
})
