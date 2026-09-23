import { describe, expect, it } from 'vitest'
import { FLOW_APP_KEYS, FLOW_APP_LIST, resolveFlowApp } from '~/utils/flowApps'

describe('registro de aplicaciones de Flow', () => {
  it('expone las seis aplicaciones de primer nivel', () => {
    expect(FLOW_APP_KEYS).toEqual(['core', 'automation', 'communications', 'sites', 'billing', 'settings'])
    expect(FLOW_APP_LIST.map(app => app.label)).toContain('Flow Core')
  })

  it.each([
    ['/', 'core'],
    ['/entidades/clientes', 'core'],
    ['/triggers', 'automation'],
    ['/chat', 'communications'],
    ['/sites', 'sites'],
    ['/facturacion/documents/123', 'billing'],
    ['/usuarios/123', 'settings']
  ] as const)('resuelve %s dentro de %s', (path, app) => {
    expect(resolveFlowApp(path)).toBe(app)
  })
})
