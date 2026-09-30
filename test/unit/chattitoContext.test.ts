import { describe, expect, it } from 'vitest'
import { MODULE_EDIT_TOURS } from '../../utils/onboardingTours'
import { MODULE_EDIT_TABS } from '../../utils/moduleEditTabs'
import { recommendedTourForContext, resolveChattitoContext } from '../../utils/chattitoContext'

describe('contexto de pantalla de Chattito', () => {
  it.each(Object.values(MODULE_EDIT_TABS))('reconoce la edición en %s sin recomendar un recorrido de creación', tab => {
    const context = resolveChattitoContext({ path: '/modulos/123/editar', params: { id: '123' }, query: { tab, source: 'test' } })
    expect(context).toEqual({ page: 'module-edit', moduleId: '123', tab })
    expect(recommendedTourForContext(context)).toBe(MODULE_EDIT_TOURS[tab])
  })

  it.each([undefined, null, 'invalid', ['fields']])('normaliza la pestaña %j', tab => {
    expect(resolveChattitoContext({ path: '/modulos/123/editar/', params: {}, query: { tab } }))
      .toEqual({ page: 'module-edit', moduleId: '123', tab: 'info' })
  })

  it('usa el parámetro de ruta decodificado cuando está disponible', () => {
    expect(resolveChattitoContext({ path: '/modulos/a%20b/editar', params: { id: 'a b' }, query: {} }))
      .toEqual({ page: 'module-edit', moduleId: 'a b', tab: 'info' })
  })

  it.each(['/', '/modulos', '/modulos/nuevo', '/modulos/123', '/modulos/123/editar/extra', '/catalogos/123/editar'])('devuelve contexto desconocido y null para %s', path => {
    const context = resolveChattitoContext({ path, params: {}, query: { tab: 'fields' } })
    expect(context).toEqual({ page: 'unknown' })
    expect(recommendedTourForContext(context)).toBeNull()
  })
})
