export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
}

export interface ConfirmDialogState extends ConfirmOptions {
  confirmLabel: string
}

const STATE_KEY = 'flow-confirm-dialog'
const pendingResolvers = new WeakMap<object, (confirmed: boolean) => void>()

export function useConfirm() {
  const nuxtApp = useNuxtApp()
  const dialog = useState<ConfirmDialogState | null>(STATE_KEY, () => null)

  function confirm(options: ConfirmOptions): Promise<boolean> {
    if (dialog.value || pendingResolvers.has(nuxtApp)) return Promise.resolve(false)
    dialog.value = { ...options, confirmLabel: options.confirmLabel || 'Confirmar' }
    return new Promise(resolve => { pendingResolvers.set(nuxtApp, resolve) })
  }

  function settle(confirmed: boolean) {
    const resolve = pendingResolvers.get(nuxtApp)
    pendingResolvers.delete(nuxtApp)
    dialog.value = null
    resolve?.(confirmed)
  }

  return { dialog, confirm, settle }
}
