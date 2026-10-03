import { ref, onBeforeUnmount } from 'vue'
import { mentionsAgenda } from '~/utils/agendaBase'

/** La decisión de crear el propio vive únicamente mientras esta página está montada. */
export function useAgendaOffer() {
  const open = ref(false)
  let declined = false
  let resolve: ((continueOwn: boolean) => void) | undefined
  function finish(continueOwn = false) {
    if (continueOwn) declined = true
    open.value = false
    resolve?.(continueOwn)
    resolve = undefined
  }
  function ask(...texts: Array<string | null | undefined>): Promise<boolean> {
    if (declined || !mentionsAgenda(...texts)) return Promise.resolve(true)
    if (resolve) return Promise.resolve(false)
    open.value = true
    return new Promise<boolean>(done => { resolve = done })
  }
  onBeforeUnmount(() => finish())
  return { open, ask, finish }
}
