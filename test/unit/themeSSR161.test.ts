import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useTheme } from '../../composables/useTheme'

afterEach(() => vi.unstubAllGlobals())
it('SSR no accede al navegador y mantiene el estado por petición', () => {
  vi.stubGlobal('window', undefined)
  vi.stubGlobal('useState', (_key: string, initialize: () => unknown) => ref(initialize()))
  vi.stubGlobal('useNuxtApp', () => ({}))
  const first = useTheme(), second = useTheme()
  expect(first.mode.value).toBe('system'); expect(first.resolved.value).toBe('light')
  expect(() => first.initialize()).not.toThrow()
  expect(() => first.setMode('dark')).not.toThrow()
  expect(second.mode.value).toBe('system')
  first.dispose()
})
