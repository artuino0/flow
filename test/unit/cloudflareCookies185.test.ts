import { afterEach, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, setCookie } from 'h3'
import { issueSessionCookies } from '../../server/utils/auth'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('las cookies de Flow son host-only, HttpOnly, Secure y SameSite=Lax', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubGlobal('setCookie', setCookie)
  const req = new IncomingMessage(new Socket()); req.headers.host = 'app.flow.test'
  const event = createEvent(req, new ServerResponse(req))
  await issueSessionCookies(event, { sub: 'user', tenantId: 'tenant', roleId: 'role', sid: 'existing-session' }, 'simulated-signing-key')
  const cookies = event.node.res.getHeader('set-cookie') as string[]
  expect(cookies).toHaveLength(2)
  for (const cookie of cookies) {
    expect(cookie).not.toMatch(/\bDomain=/i)
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax')
  }
})
