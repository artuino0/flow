import { contextualTourMatchesRoute, writeTourCompletion } from '~/utils/onboardingTours'
import { chattitoHelpCatalog, chattitoHelpStorageKey, type ChattitoHelpId } from '~/utils/chattitoHelp'
import type { ModuleEditTab } from '~/utils/moduleEditTabs'

export function useModuleTourHelp(tab: ModuleEditTab) {
  return useContextualTourHelp(`module-edit:${tab}`)
}

export function useContextualTourHelp(helpId: ChattitoHelpId) {
  const { activeId, canLaunchTour, startTour } = useOnboarding()
  const { user } = useAuth()
  const route = useRoute()
  const launching = ref(false)
  const tourId = chattitoHelpCatalog[helpId].tourId!
  const available = computed(() => canLaunchTour(tourId) && contextualTourMatchesRoute(tourId, route.path, route.query))
  const disabled = computed(() => Boolean(activeId.value) || launching.value)
  const memory = useState<string[]>('chattito-help-memory', () => [])

  async function launch() {
    if (!available.value || disabled.value) return false
    launching.value = true
    try {
      const current = user.value
      if (current?.authenticated) {
        for (const kind of ['seen', 'dismissed'] as const) {
          const key = chattitoHelpStorageKey(current.tenantId, current.id, helpId, kind)
          if (!memory.value.includes(key)) memory.value = [...memory.value, key]
          if (import.meta.client) writeTourCompletion(localStorage, key)
        }
      }
      return await startTour(tourId)
    } finally { launching.value = false }
  }
  return { available, disabled, launch }
}
