// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, ref, Suspense, type App, type Component } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import { useTheme } from '../../composables/useTheme'
import { THEME_STORAGE_KEY, themeBootstrap, type ThemeMode } from '../../utils/theme'
import * as returnToRoute from '../../utils/returnToRoute'

const apps: App[] = []
let theme: ReturnType<typeof useTheme> | undefined
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
  theme?.dispose(); theme = undefined
  document.body.innerHTML = ''; document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
  window.localStorage.clear()
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

async function mountLogin(mode: ThemeMode = 'system', systemDark = false) {
  const state = ref({ mode: 'system' as ThemeMode, resolved: 'light' as 'light' | 'dark' })
  const appState = {}
  vi.stubGlobal('useState', () => state)
  vi.stubGlobal('useNuxtApp', () => appState)
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: systemDark, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  document.head.innerHTML = '<meta name="theme-color">'
  new Function('localStorage', 'window', 'document', themeBootstrap)(window.localStorage, window, document)
  theme = useTheme(); theme.initialize()
  const selector = compileVueComponent('components/ThemeSelector.vue', {}, { useTheme })
  const meta = vi.fn(), navigate = vi.fn(), login = vi.fn(async () => ({}))
  let finishPage: (() => void) | undefined
  navigate.mockImplementation(async () => { finishPage?.() })
  const page = compileVueComponent('pages/login.vue', { '~/utils/returnToRoute': returnToRoute }, {
    ref, computed, definePageMeta: meta,
    useAuth: () => ({ login, loginWithTotp: vi.fn(), selectOrganization: vi.fn(), user: ref({ role: 'administrador' }) }),
    useRoute: () => ({ query: {} }), navigateTo: navigate,
    useState: () => ref(false),
    useNuxtApp: () => ({ hook: (name: string, fn: () => void) => { if (name === 'page:finish') finishPage = fn; return () => { if (name === 'page:finish') finishPage = undefined } } }),
    useDeploymentConfig: async () => ({ data: ref({ appMode: 'shared' }) })
  })
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(page) }) })
  app.component('ThemeSelector', selector)
  const link: Component = { setup(_, { attrs, slots }) { return () => h('a', { href: attrs.to }, slots.default?.()) } }
  app.component('NuxtLink', link)
  const host = document.createElement('div'); document.body.append(host)
  apps.push(app); app.mount(host); await flush()
  return { host, meta, navigate, login, selector }
}

async function choose(host: Element, label: string) {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  expect(trigger, 'el login debe renderizar el selector real').toBeTruthy()
  trigger!.click(); await flush()
  const option = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.trim() === label)
  expect(option).toBeTruthy(); option!.click(); await flush()
}

it('renderiza el selector real fuera del formulario, fijo y con espacio reservado a 390 px', async () => {
  const { host, meta } = await mountLogin()
  const trigger = host.querySelector('button[aria-haspopup="menu"]')
  expect(trigger).toBeTruthy(); expect(trigger?.closest('form')).toBeNull()
  expect(trigger?.closest('.fixed')?.className).toBe('fixed right-4 top-4 z-50')
  expect(host.querySelector('form')?.parentElement?.classList.contains('py-20')).toBe(true)
  expect(meta).toHaveBeenCalledWith({ layout: false, darkReady: true })
  expect(host.querySelector('.theme-light')).toBeNull()
})

it.each([false, true])('Claro/Oscuro/Sistema actualizan documento y almacenamiento con sistema oscuro=%s', async systemDark => {
  const { host } = await mountLogin('system', systemDark)
  for (const [label, mode, resolved] of [['Oscuro', 'dark', 'dark'], ['Claro', 'light', 'light'], ['Sistema', 'system', systemDark ? 'dark' : 'light']] as const) {
    await choose(host, label)
    expect(document.documentElement.dataset.theme).toBe(resolved)
    expect(document.documentElement.classList.contains('dark')).toBe(resolved === 'dark')
    expect(document.documentElement.style.colorScheme).toBe(resolved)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(mode)
    expect(host.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')).toBe(`Tema: ${label}`)
    expect(host.querySelector('[role="menu"]')).toBeNull()
  }
})

it.each(['light', 'dark', 'system'] as const)('el arranque mantiene la preferencia %s al montar el login', async mode => {
  const { host } = await mountLogin(mode, true)
  expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(mode)
  expect(host.querySelector('button[aria-haspopup="menu"]')).toBeTruthy()
})

it('iniciar sesión conserva el tema y lo comparte con el selector siguiente', async () => {
  const { host, navigate, login, selector } = await mountLogin()
  await choose(host, 'Oscuro')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(login).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledOnce()
  apps.splice(0).forEach(app => app.unmount())
  const nextHost = document.createElement('div'); document.body.append(nextHost)
  const nextApp = createApp(selector); apps.push(nextApp); nextApp.mount(nextHost); await flush()
  expect(nextHost.querySelector('button')?.getAttribute('aria-label')).toBe('Tema: Oscuro')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
})
