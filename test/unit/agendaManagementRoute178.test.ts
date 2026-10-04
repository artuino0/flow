import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
const mock = vi.hoisted(() => ({ context: vi.fn(), presentation: vi.fn() }))
vi.mock('../../server/utils/agendaPublic', () => ({ resolveAgendaContext: mock.context, publicAgendaPresentation: mock.presentation }))
import handler from '../../server/routes/agenda-manage/[site]/[page].get'
beforeEach(() => { mock.context.mockReset().mockResolvedValue({}); mock.presentation.mockReset().mockResolvedValue({ runtime: { site: 's', page: 'p', timezone: 'UTC', locale: 'es', accent: 'rgb(0 110 132)' } }) })
function event(site: string = randomUUID(), page: string = randomUUID()) {
  const request = new IncomingMessage(new Socket()); request.url = `/agenda-manage/${site}/${page}`; request.headers.host = 'localhost:3000'; const response = new ServerResponse(request)
  const result = createEvent(request, response); result.context.params = { site, page }; return result
}
describe('Ruta dedicada de gestión sin red ni cookies', () => {
  it('entrega documento claro aislado, encabezados privados y solo script de Flow con nonce', async () => {
    const request = event(); const html = await handler(request) as string
    expect(request.node.res.getHeader('X-Robots-Tag')).toBe('noindex, nofollow'); expect(request.node.res.getHeader('Referrer-Policy')).toBe('no-referrer'); expect(request.node.res.getHeader('Cache-Control')).toBe('no-store'); expect(request.node.res.getHeader('Set-Cookie')).toBeUndefined()
    const csp = String(request.node.res.getHeader('Content-Security-Policy')); const nonce = csp.match(/nonce-([^']+)/)![1]!
    expect(html).toContain(`nonce="${nonce}"`); expect(html).toContain('content="noindex,nofollow"'); expect(html).toContain('color-scheme:light'); expect(html).not.toContain('AppNav'); expect(html).not.toMatch(/localStorage|sessionStorage|document\.cookie/); expect(csp).toContain("script-src-attr 'none'")
  })
  it('IDs inválidos y sitio no disponible entregan el mismo documento público de enlace vencido', async () => {
    const invalid = event('bad', 'bad'); const invalidHtml = await handler(invalid); expect(invalid.node.res.statusCode).toBe(404); expect(mock.context).not.toHaveBeenCalled()
    mock.context.mockRejectedValue({ statusCode: 404 }); const unavailable = event(); const unavailableHtml = await handler(unavailable); expect(unavailable.node.res.statusCode).toBe(404)
    expect(String(invalidHtml).replace(/nonce="[^"]+"/, '')).toBe(String(unavailableHtml).replace(/nonce="[^"]+"/, ''))
  })
})
