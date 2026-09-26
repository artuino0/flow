import { describe, it, expect, beforeEach } from 'vitest'
import { useConfirm, type ConfirmDialogState } from '../../composables/useConfirm'

const state = { value: null as ConfirmDialogState | null }
const nuxtApp = {}
;(globalThis as any).useState = (_key: string, init: () => ConfirmDialogState | null) => {
  if (state.value === null) state.value = init()
  return state
}
;(globalThis as any).useNuxtApp = () => nuxtApp

describe('useConfirm', () => {
  beforeEach(() => { state.value = null })

  it('resuelve true al confirmar', async () => {
    const confirmation = useConfirm()
    const result = confirmation.confirm({ title: 'Eliminar', message: '¿Continuar?' })
    expect(confirmation.dialog.value?.confirmLabel).toBe('Confirmar')
    confirmation.settle(true)
    await expect(result).resolves.toBe(true)
  })

  it('resuelve false al cancelar o pulsar Esc', async () => {
    const confirmation = useConfirm()
    const canceled = confirmation.confirm({ title: 'Eliminar', message: '¿Continuar?' })
    confirmation.settle(false)
    await expect(canceled).resolves.toBe(false)
    const escaped = confirmation.confirm({ title: 'Eliminar', message: '¿Continuar?' })
    confirmation.settle(false)
    await expect(escaped).resolves.toBe(false)
  })

  it('mantiene un solo diálogo abierto', async () => {
    const confirmation = useConfirm()
    const first = confirmation.confirm({ title: 'Primero', message: 'A' })
    await expect(confirmation.confirm({ title: 'Segundo', message: 'B' })).resolves.toBe(false)
    expect(confirmation.dialog.value?.title).toBe('Primero')
    confirmation.settle(false)
    await expect(first).resolves.toBe(false)
  })
})
