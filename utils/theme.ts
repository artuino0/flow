export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export const THEME_STORAGE_KEY = 'flowerp-theme'

// Se serializa esta misma función en el head: ninguna decisión duplicada.
export function resolveTheme(mode: unknown, systemDark: boolean): ResolvedTheme {
  return mode === 'dark' || (mode !== 'light' && systemDark) ? 'dark' : 'light'
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function contentNeedsLight(meta: { darkReady?: unknown; layout?: unknown }): boolean {
  return meta.darkReady !== true
}

export const themeBootstrap = `(${function () {
  let mode: string | null = null
  try { mode = localStorage.getItem('flowerp-theme') } catch { /* Preferencia en memoria. */ }
  let systemDark = false
  try { systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches } catch { /* Navegador sin matchMedia. */ }
  const theme = RESOLVE(mode, systemDark)
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#141B29' : '#F5F8FA')
}.toString().replace('RESOLVE', `(${resolveTheme.toString()})`)})();`

// Referencia de tipado para el cuerpo serializado; el script inserta resolveTheme.
declare function RESOLVE(mode: unknown, systemDark: boolean): ResolvedTheme

export interface ThemeEnvironment {
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
  media: () => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>
  apply: (theme: ResolvedTheme) => void
}

/** Controlador independiente del DOM/Nuxt, comprobable sin red ni SSR global. */
export function createThemeController(environment: ThemeEnvironment, changed: (mode: ThemeMode, theme: ResolvedTheme) => void) {
  let mode: ThemeMode = 'system'
  let media: ReturnType<ThemeEnvironment['media']> | undefined
  function apply() {
    const theme = resolveTheme(mode, media?.matches ?? false)
    environment.apply(theme)
    changed(mode, theme)
  }
  function initialize() {
    try { mode = normalizeThemeMode(environment.storage().getItem(THEME_STORAGE_KEY)) } catch { mode = 'system' }
    try { media = environment.media(); media.addEventListener('change', apply) } catch { media = undefined }
    apply()
  }
  function setMode(value: ThemeMode) {
    mode = normalizeThemeMode(value)
    try { environment.storage().setItem(THEME_STORAGE_KEY, mode) } catch { /* El cambio sigue vigente en memoria. */ }
    apply()
  }
  function dispose() { media?.removeEventListener('change', apply) }
  return { initialize, setMode, dispose }
}
