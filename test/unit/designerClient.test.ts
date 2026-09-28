import { describe, expect, it, vi } from 'vitest'
import { createDesignerClient } from '~/utils/designerClient'
import type { Blueprint } from '~/server/utils/blueprint/schema'

describe('cliente HTTP del diseñador', () => {
  it('conecta la sesión, la generación, la edición gratuita y la aprobación con sus API', async () => {
    const request = vi.fn(async (_url: string, _options?: unknown) => ({ ok: true }))
    const api = createDesignerClient(request)
    const blueprint: Blueprint = { version: 1, summary: 'Prueba', modules: [], associations: [] }
    await api.listSessions()
    await api.createSession()
    await api.getSession('123')
    await api.getCurrent()
    await api.getCredits()
    await api.getNavigation()
    await api.getLayout()
    await api.putLayout({ clientes: { x: 12, y: 20 } })
    await api.validate(blueprint)
    await api.generate('123', 'Agrega órdenes')
    await api.save('123', blueprint)
    await api.apply('123')
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/module-designer/sessions', '/api/module-designer/sessions', '/api/module-designer/sessions/123',
      '/api/blueprints/current', '/api/billing/ai-credits', '/api/navigation', '/api/module-designer/layout', '/api/module-designer/layout',
      '/api/blueprints/validate', '/api/module-designer/sessions/123/messages', '/api/module-designer/sessions/123/blueprint', '/api/module-designer/sessions/123/apply'
    ])
    expect(request.mock.calls[7]?.[1]).toEqual({ method: 'PUT', body: { positions: { clientes: { x: 12, y: 20 } } } })
    expect(request.mock.calls[9]?.[1]).toEqual({ method: 'POST', body: { instruction: 'Agrega órdenes' } })
    expect(request.mock.calls[10]?.[1]).toEqual({ method: 'PUT', body: blueprint })
    expect(request.mock.calls[11]?.[1]).toEqual({ method: 'POST', body: {} })
  })
})
