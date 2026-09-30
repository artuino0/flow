import { canReadChattitoHelp, chattitoHelpId, chattitoHelpMessage, chattitoHelpStorageKey, helpForContext, shouldShowChattitoHelp } from '~/utils/chattitoHelp'
import { canStartOnboarding, readTourCompletion, writeTourCompletion } from '~/utils/onboardingTours'

export function useChattitoHelp() {
  const { context } = useChattitoContext()
  const { user } = useAuth()
  const route = useRoute()
  const { data: isAdmin, status: adminStatus } = useIsAdmin()
  const { activeId, canLaunchTour, startTour } = useOnboarding()
  const { panel, addMessage } = useChattitoPanel()
  const { ready, disabled, setDisabled } = useChattitoHelpPreferences()
  const memory = useState<string[]>('chattito-help-memory', () => [])
  const activeKey = ref<string | null>(null)
  const help = computed(() => helpForContext(context.value))
  const id = computed(() => chattitoHelpId(context.value))
  const keys = computed(() => {
    const current = user.value
    if (!current?.authenticated || !id.value) return null
    return {
      seen: chattitoHelpStorageKey(current.tenantId, current.id, id.value, 'seen'),
      dismissed: chattitoHelpStorageKey(current.tenantId, current.id, id.value, 'dismissed')
    }
  })
  function stored(key: string) {
    return memory.value.includes(key) || Boolean(import.meta.client && readTourCompletion(localStorage, key))
  }
  function mark(key: string) {
    if (!memory.value.includes(key)) memory.value = [...memory.value, key]
    if (import.meta.client) writeTourCompletion(localStorage, key)
  }
  const eligible = computed(() => Boolean(ready.value && help.value && keys.value && shouldShowChattitoHelp({
    eligible: canStartOnboarding(user.value, route.path, route.meta.layout),
    permitted: Boolean(help.value && canReadChattitoHelp(help.value, { isAdmin: adminStatus.value === 'success' && isAdmin.value === true, designerAvailable: false })),
    disabled: disabled.value,
    dismissed: keys.value ? stored(keys.value.dismissed) : false,
    seen: false,
    activeTour: Boolean(activeId.value),
    conversationOpen: (panel.value.open && panel.value.messages.length > 0) || panel.value.avatarState === 'typing'
  })))
  watch([() => keys.value?.seen, eligible], ([key, allowed]) => {
    if (!key || !allowed) { activeKey.value = null; return }
    if (activeKey.value === key) return
    activeKey.value = null
    if (stored(key)) return
    activeKey.value = key
    mark(key)
  }, { immediate: true })
  const visible = computed(() => eligible.value && activeKey.value === keys.value?.seen)
  const tourId = computed(() => help.value?.tourId && canLaunchTour(help.value.tourId) ? help.value.tourId : null)

  function dismiss() {
    if (keys.value) mark(keys.value.dismissed)
    activeKey.value = null
  }
  function explain() {
    if (!visible.value || !help.value) return
    // El panel existente y su conversación se conservan; en un chat nuevo la ayuda va primero.
    if (!panel.value.conversationStarted) panel.value.messages = []
    addMessage({ role: 'assistant', text: chattitoHelpMessage(help.value) })
    panel.value.conversationStarted = true
    panel.value.open = true
    dismiss()
  }
  function runTour() {
    if (!visible.value || !tourId.value) return
    const selected = tourId.value
    dismiss()
    void startTour(selected)
  }
  return { help, visible, tourId, dismiss, explain, runTour, disable: () => setDisabled(true) }
}
