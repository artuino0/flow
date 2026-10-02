// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useTheme } from '../../composables/useTheme'

afterEach(() => vi.unstubAllGlobals())
it('el composable comparte estado en la app, aplica el DOM y persiste por dispositivo', () => {
  const memory = new Map<string, ReturnType<typeof ref>>()
  const app = {}
  vi.stubGlobal('useState', (key: string, initialize: () => unknown) => {
    if (!memory.has(key)) memory.set(key, ref(initialize()))
    return memory.get(key)
  })
  vi.stubGlobal('useNuxtApp', () => app)
  document.head.innerHTML = '<meta name="theme-color">'
  let listener: (() => void) | undefined
  const media = { matches: false, addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback }), removeEventListener: vi.fn() }
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media })
  window.localStorage.setItem('flowerp-theme', 'dark')
  const first = useTheme(), second = useTheme()
  first.initialize()
  expect(second.mode.value).toBe('dark'); expect(second.resolved.value).toBe('dark')
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.documentElement.style.colorScheme).toBe('dark')
  expect(document.querySelector('meta')?.getAttribute('content')).toBe('#141B29')
  second.setMode('light'); expect(first.mode.value).toBe('light')
  expect(window.localStorage.getItem('flowerp-theme')).toBe('light')
  second.setMode('system'); media.matches = true; listener!()
  expect(first.resolved.value).toBe('dark')
  first.dispose(); expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
})
