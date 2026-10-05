import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { captureEdgeHost } from '../../server/utils/effectiveHost'
const submit = vi.hoisted(() => vi.fn(async () => ({ id: 'submission' })))
vi.mock('../../server/utils/siteFormSubmissions', () => ({ submitSiteForm: submit }))
vi.mock('../../server/utils/recordActorContext', () => ({ withSystemRecordAccess: async (fn: () => unknown) => fn() }))
beforeEach(() => {
  vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge')
  vi.stubGlobal('defineEventHandler', defineEventHandler); vi.stubGlobal('getHeader', getHeader); vi.stubGlobal('setResponseStatus', setResponseStatus)
  vi.stubGlobal('readValidatedBody', async () => ({ siteId: 'site', pageId: 'page', formKey: 'contact', payload: { name: 'Ana' }, href: 'https://www.cliente.test/contacto?utm_source=demo' }))
  submit.mockClear()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it.each([{ secret: 'simulated-edge', domain: 'www.cliente.test' }, { secret: 'incorrecto', domain: 'origin.flow.test' }, { secret: '', domain: 'origin.flow.test' }])('formulario atribuye el host según secreto: $domain', async ({ secret, domain }) => {
  const req = new IncomingMessage(new Socket()); req.method = 'POST'; req.url = '/api/sites/forms/submit'
  req.headers = { host: 'origin.flow.test', 'x-forwarded-host': 'www.cliente.test', 'x-flow-edge-secret': secret }
  const event = createEvent(req, new ServerResponse(req)); captureEdgeHost(event)
  const handler = (await import('../../server/api/sites/forms/submit.post')).default
  expect(await handler(event)).toEqual({ ok: true, id: 'submission' })
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ origin: expect.objectContaining({ domain, path: '/contacto', utm: { source: 'demo' } }) }))
  expect(JSON.stringify(submit.mock.calls)).not.toContain('simulated-edge'); expect(JSON.stringify(submit.mock.calls)).not.toContain('x-forwarded-host')
})
