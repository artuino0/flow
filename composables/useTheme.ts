import { computed } from 'vue'
import { createThemeController, type ThemeMode, type ResolvedTheme } from '~/utils/theme'

export function useTheme() {
  const state = useState('flow-theme', () => ({ mode: 'system' as ThemeMode, resolved: 'light' as ResolvedTheme }))
  // El controlador pertenece a esta app cliente, nunca a un singleton SSR.
  const nuxtApp = useNuxtApp()
  function controller() {
    if (typeof window === 'undefined') return undefined
    if (!nuxtApp._flowTheme) {
      nuxtApp._flowTheme = createThemeController({
        storage: () => window.localStorage,
        media: () => window.matchMedia('(prefers-color-scheme: dark)'),
        apply(theme) {
          const root = document.documentElement
          root.dataset.theme = theme
          root.classList.toggle('dark', theme === 'dark')
          root.style.colorScheme = theme
          document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141B29' : '#F5F8FA')
        }
      }, (mode, resolved) => { state.value = { mode, resolved } })
    }
    return nuxtApp._flowTheme
  }
  return {
    mode: computed(() => state.value.mode), resolved: computed(() => state.value.resolved),
    initialize: () => controller()?.initialize(),
    setMode: (mode: ThemeMode) => controller()?.setMode(mode),
    dispose: () => nuxtApp._flowTheme?.dispose()
  }
}

declare module '#app' {
  interface NuxtApp { _flowTheme?: ReturnType<typeof createThemeController> }
}
