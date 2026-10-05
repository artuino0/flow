import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
const mock = vi.hoisted(() => ({ presentation: vi.fn() }))
vi.mock('../../server/utils/agendaPublic', () => ({ resolveAgendaContext: async () => ({}), publicAgendaPresentation: mock.presentation }))
import handler from '../../server/routes/agenda-manage/[site]/[page].get'
beforeEach(() => mock.presentation.mockReset())
it.each([false, true])('CSP exacta solo añade script/frame de desafíos si está activa: %s', async enabled => {
  mock.presentation.mockResolvedValue({ runtime: { site: 's', page: 'p', locale: 'es', timezone: 'UTC', accent: 'rgb(0 110 132)', ...(enabled ? { turnstileSiteKey: 'test' } : {}) } })
  const req = new IncomingMessage(new Socket()); req.url = '/agenda-manage/s/p'; req.headers.host = 'localhost:3000'
  const event = createEvent(req, new ServerResponse(req)); event.context.params = { site: randomUUID(), page: randomUUID() }
  await handler(event)
  const csp = String(event.node.res.getHeader('Content-Security-Policy')).replace(/nonce-[^']+/, 'nonce-TEST')
  expect(csp).toBe(`script-src 'nonce-TEST'${enabled ? ' https://challenges.cloudflare.com' : ''};${enabled ? ' frame-src https://challenges.cloudflare.com;' : ''} script-src-attr 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`)
  expect(csp).not.toContain('unsafe-inline')
})
