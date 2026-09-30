import { MODULE_EDIT_TOURS, moduleEditTourMatchesRoute, writeTourCompletion } from '~/utils/onboardingTours'
import { chattitoHelpStorageKey } from '~/utils/chattitoHelp'
import type { ModuleEditTab } from '~/utils/moduleEditTabs'

export function useModuleTourHelp(tab: ModuleEditTab) {
  const { activeId, canLaunchTour, startTour } = useOnboarding()
  const { user } = useAuth()
  const route = useRoute()
  const launching = ref(false)
  const tourId = MODULE_EDIT_TOURS[tab]
  const available = computed(() => canLaunchTour(tourId) && moduleEditTourMatchesRoute(tourId, route.path, route.query.tab))
  const disabled = computed(() => Boolean(activeId.value) || launching.value)
  const memory = useState<string[]>('chattito-help-memory', () => [])

  async function launch() {
    if (!available.value || disabled.value) return false
    launching.value = true
    try {
      const current = user.value
      if (current?.authenticated) {
        for (const kind of ['seen', 'dismissed'] as const) {
          const key = chattitoHelpStorageKey(current.tenantId, current.id, `module-edit:${tab}`, kind)
          if (!memory.value.includes(key)) memory.value = [...memory.value, key]
          if (import.meta.client) writeTourCompletion(localStorage, key)
        }
      }
      return await startTour(tourId)
    } finally { launching.value = false }
  }
  return { available, disabled, launch }
}
