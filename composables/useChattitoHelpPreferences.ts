import { chattitoHelpPreferenceKey } from '~/utils/chattitoHelp'
import { readTourCompletion, writeTourCompletion } from '~/utils/onboardingTours'

export function useChattitoHelpPreferences() {
  const { user } = useAuth()
  const disabledKeys = useState<string[]>('chattito-help-disabled', () => [])
  const loadedKeys = useState<string[]>('chattito-help-loaded', () => [])
  const key = computed(() => user.value?.authenticated ? chattitoHelpPreferenceKey(user.value.tenantId, user.value.id) : null)
  const ready = computed(() => Boolean(key.value && loadedKeys.value.includes(key.value)))
  const disabled = computed(() => Boolean(key.value && disabledKeys.value.includes(key.value)))

  function load() {
    if (!import.meta.client || !key.value || loadedKeys.value.includes(key.value)) return
    if (readTourCompletion(localStorage, key.value)) disabledKeys.value = [...disabledKeys.value, key.value]
    loadedKeys.value = [...loadedKeys.value, key.value]
  }
  onMounted(load)
  watch(key, load)

  function setDisabled(value: boolean) {
    if (!key.value) return
    disabledKeys.value = disabledKeys.value.filter(item => item !== key.value)
    if (value) disabledKeys.value.push(key.value)
    if (!import.meta.client) return
    if (value) writeTourCompletion(localStorage, key.value)
    else {
      try { localStorage.removeItem(key.value) } catch { /* La preferencia se conserva en memoria durante esta sesión. */ }
    }
  }
  return { ready, disabled, setDisabled }
}
