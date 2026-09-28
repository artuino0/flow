import { describe, expect, it } from 'vitest'
import { beginDesignerChat, canSendDesignerChat, designerChatEntries, failDesignerChat, toggleDesignerFocus } from '../../utils/designerChat'

describe('estado del chat del diseñador', () => {
  const when = '2026-09-27T12:00:00.000Z'

  it('muestra el envío optimista y el indicador mientras bloquea otro envío', () => {
    const drafts = beginDesignerChat([], 'Crea pedidos', 'draft-1', when)
    expect(designerChatEntries([], drafts)).toMatchObject([{ role: 'user', content: 'Crea pedidos', draft: { status: 'pending' } }])
    expect(canSendDesignerChat({ busy: true, noCredits: false, dirty: false, applied: false })).toBe(false)
  })

  it('sustituye el borrador por el historial persistido después del éxito', () => {
    const messages = [{ role: 'user' as const, content: 'Crea pedidos', createdAt: when }, { role: 'assistant' as const, content: 'Preparé pedidos.', createdAt: '2026-09-27T12:00:01.000Z' }]
    expect(designerChatEntries(messages, [])).toMatchObject([{ role: 'user', content: 'Crea pedidos' }, { role: 'assistant', content: 'Preparé pedidos.' }])
  })

  it('conserva el mensaje fallido y reintenta el mismo borrador sin duplicarlo', () => {
    const failed = failDesignerChat(beginDesignerChat([], 'Crea pedidos', 'draft-1', when), 'draft-1', 'ai_unavailable', 503)
    expect(failed[0]).toMatchObject({ content: 'Crea pedidos', status: 'failed', action: 'retry' })
    expect(failed[0]?.error).toContain('No se cobraron créditos')
    const retry = beginDesignerChat(failed, 'otro texto', 'draft-1', when, 'draft-1')
    expect(retry).toHaveLength(1)
    expect(retry[0]).toMatchObject({ content: 'Crea pedidos', status: 'pending', error: '' })
  })

  it('ofrece mejorar el plan ante 402 y bloquea el envío sin créditos', () => {
    const failed = failDesignerChat(beginDesignerChat([], 'Crea pedidos', 'draft-1', when), 'draft-1', 'ai_credits', 402)
    expect(failed[0]).toMatchObject({ status: 'failed', action: 'plan' })
    expect(canSendDesignerChat({ busy: false, noCredits: true, dirty: false, applied: false })).toBe(false)
  })

  it('al recargar muestra solo el historial guardado', () => {
    expect(designerChatEntries([], [])).toEqual([])
  })

  it('expande y contrae sin alterar anchos ni selección del lienzo', () => {
    const canvasState = { zoom: 1.4, x: 240, y: 120, selectedId: 'pedidos', relationFilter: 'all' }
    const base = { focused: false, chatWidth: 412, inspectorWidth: 356, canvasState }
    const expanded = toggleDesignerFocus(base)
    expect(expanded).toMatchObject({ focused: true, chatWidth: 412, inspectorWidth: 356 })
    expect(toggleDesignerFocus(expanded)).toEqual(base)
    expect(expanded.canvasState).toBe(canvasState)
  })
})
