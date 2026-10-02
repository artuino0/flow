// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App } from 'vue'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { compileVueComponent } from '../helpers/vueComponent'
import { brandColors, darkTokens, lightTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight, createThemeController, normalizeThemeMode, resolveTheme, themeBootstrap } from '../../utils/theme'
import { themeContrasts } from '../helpers/themeContrast'
import baseline from '../fixtures/themeLight161.json'

const apps: App[] = []
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('contrato de tokens y alcance de HU-161', () => {
  it('conserva todos los nombres y cada hex claro anterior, y define pares RGB completos', () => {
    for (const [name, hex] of Object.entries(baseline)) expect(lightTokens[name as keyof typeof lightTokens]).toBe(hex)
    expect(Object.keys(darkTokens).sort()).toEqual(Object.keys(lightTokens).sort())
    const css = readFileSync('assets/css/theme.css', 'utf8')
    const lightScope = css.slice(css.indexOf('.theme-light,'), css.indexOf('@media print'))
    for (const [name, hex] of Object.entries(lightTokens)) {
      expect(brandColors[name]).toBe(`rgb(var(--brand-${name}) / <alpha-value>)`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(darkTokens[name as keyof typeof lightTokens])};`)
      expect(lightScope).toContain(`--brand-${name}: ${rgbChannels(hex)};`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(hex)} !important;`)
    }
    expect(css).toContain('color-scheme: dark')
    expect(css).toContain(':not([data-theme-shell])')
  })

  it('genera los modificadores de opacidad reales con Tailwind', async () => {
    const require = createRequire(import.meta.url)
    const postcss = require('postcss')
    const tailwind = require('tailwindcss')
    const result = await postcss([tailwind({ content: [{ raw: '<div class="ring-brand-blue/25 bg-brand-bg/60 border-brand-error-text/30 bg-brand-orange/10"></div>' }], theme: { extend: { colors: { brand: brandColors } } } })]).process('@tailwind utilities;', { from: undefined })
    expect(result.css).toContain('rgb(var(--brand-blue) / 0.25)')
    expect(result.css).toContain('rgb(var(--brand-bg) / 0.6)')
    expect(result.css).toContain('rgb(var(--brand-error-text) / 0.3)')
    expect(result.css).toContain('rgb(var(--brand-orange) / 0.1)')
    expect(result.css).not.toContain('<alpha-value>')
  })

  it('mantiene claras las páginas sin marca y las públicas, y migra las rutas acordadas', () => {
    expect(contentNeedsLight({})).toBe(true)
    expect(contentNeedsLight({ darkReady: false })).toBe(true)
    expect(contentNeedsLight({ darkReady: 'true' })).toBe(true)
    expect(contentNeedsLight({ darkReady: true })).toBe(false)
    expect(contentNeedsLight({ darkReady: true, layout: false })).toBe(true)
    for (const file of ['pages/index.vue', 'pages/registros/[entity]/index.vue', 'pages/registros/[entity]/[id]/index.vue']) expect(readFileSync(file, 'utf8')).toContain('darkReady: true')
    expect(readFileSync('layouts/default.vue', 'utf8')).toContain("forceLightContent ? 'theme-light bg-brand-bg'")
    const header = readFileSync('layouts/default.vue', 'utf8')
    expect(header.indexOf('<NotificationCenter />')).toBeLessThan(header.indexOf('<ThemeSelector />'))
    expect(header.indexOf('<ThemeSelector />')).toBeLessThan(header.indexOf('<ChattitoToggle'))
    for (const file of ['components/PrintReportPage.vue', 'components/PrintReportSheet.vue', 'components/PrintReportPreview.vue']) expect(readFileSync(file, 'utf8')).toContain('theme-light')
    expect(readFileSync('components/RecordDetailView.vue', 'utf8')).toContain('<ActivityTimeline class="theme-light"')
  })

  it('comprueba AA en los valores derivados oscuros y congela las excepciones de Pencil y del claro original', () => {
    const exceptions = {
      'light:text-muted/bg': 2.493, 'light:text-muted/surface': 2.659,
      'light:primary-fg/orange': 2.567, 'light:primary-fg/orange-hover': 3.129,
      'light:blue/surface': 3.709, 'light:accent-fg/blue': 3.709,
      'light:border/surface': 1.473, 'light:control-border/surface': 1.473,
      'light:success-text/success-bg': 4.401, 'light:warning-text/warning-bg': 3.493,
      'light:error-text/error-bg': 4.167, 'light:info-text/info-bg': 3.312, 'light:panel-muted/panel-soft': 3.974,
      'light:pink-text/pink-bg': 4.400, 'light:gold-text/gold-bg': 4.388,
      'dark:text-muted/surface': 4.187, 'dark:border/surface': 1.597
    }
    const results = themeContrasts()
    expect(results.filter(result => result.ratio < result.minimum).map(result => result.id).sort()).toEqual(Object.keys(exceptions).sort())
    for (const result of results) {
      const known = exceptions[result.id as keyof typeof exceptions]
      if (known !== undefined) expect(result.ratio).toBeCloseTo(known, 3)
      else expect(result.ratio, result.id).toBeGreaterThanOrEqual(result.minimum)
    }
  })
})

it('el layout real aísla el contenido sin darkReady y conserva el cascarón en el tema global', async () => {
  const route = reactive({ path: '/disenador', fullPath: '/disenador', meta: {} as { darkReady?: boolean; layout?: boolean } })
  const layout = compileVueComponent('layouts/default.vue', {
    '~/utils/theme': { contentNeedsLight },
    '~/utils/returnToRoute': { IDLE_RETURN_KEY: 'test', safeInternalRoute: (value: string) => value },
    '~/utils/onboardingTours': { tourNeedsMobileMenu: () => false }
  }, {
    ref, computed, watch, onMounted, onBeforeUnmount,
    useAuth: () => ({ user: ref(null), logout: vi.fn() }),
    useChat: () => ({ canAccess: ref(false), unreadCount: ref(0), initialize: vi.fn(), dispose: vi.fn() }),
    useSettingsDirty: () => ({ dirty: ref(false), saveHandler: ref(null), discardHandler: ref(null) }),
    useConfirm: () => ({ dialog: ref(null), settle: vi.fn() }), useRoute: () => route,
    useFlowApps: () => ({ activeKey: ref('erp') }),
    useOnboarding: () => ({ navigationTourId: ref(null), navigationTourIndex: ref(0) }),
    useIdleTimeout: () => ({ showWarning: ref(false), countdown: ref(0), warningSeconds: 60, confirmActive: vi.fn() })
  })
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(layout, {}, { default: () => h('p', 'Contenido') }) })
  for (const name of ['NuxtLink', 'FlowAppLauncher', 'GlobalSearch', 'NotificationCenter', 'ThemeSelector', 'ChattitoToggle', 'InactivityWarningModal', 'SettingsConfirmDialog', 'AppNav', 'ChatFloatingDock', 'ToastContainer']) app.component(name, { render: () => h('span') })
  app.mount(host); apps.push(app); await nextTick()
  expect(host.querySelector('main')?.classList.contains('theme-light')).toBe(true)
  expect(host.querySelector('header')?.closest('.theme-light')).toBeNull()
  expect(host.querySelector('aside')?.closest('.theme-light')).toBeNull()
  expect(host.querySelector('main')?.textContent).toBe('Contenido')
  route.meta.darkReady = true; await nextTick()
  expect(host.querySelector('main')?.classList.contains('theme-light')).toBe(false)
  route.meta.layout = false; await nextTick()
  expect(host.querySelector('main')?.classList.contains('theme-light')).toBe(true)
})

describe('decisión única y controlador de tema', () => {
  it('resuelve los tres modos y preferencias dañadas', () => {
    for (const systemDark of [false, true]) {
      expect(resolveTheme('light', systemDark)).toBe('light')
      expect(resolveTheme('dark', systemDark)).toBe('dark')
      for (const mode of ['system', null, 'inválido', undefined]) expect(resolveTheme(mode, systemDark)).toBe(systemDark ? 'dark' : 'light')
    }
    expect(normalizeThemeMode('incorrecto')).toBe('system')
  })

  it('sigue el sistema en vivo, persiste cambios y retira el listener', () => {
    let listener: (() => void) | undefined
    const media = { matches: true, addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback }), removeEventListener: vi.fn() }
    const storage = { getItem: vi.fn(() => 'system'), setItem: vi.fn() }
    const apply = vi.fn(), changed = vi.fn()
    const controller = createThemeController({ storage: () => storage, media: () => media, apply }, changed)
    controller.initialize(); expect(changed).toHaveBeenLastCalledWith('system', 'dark')
    media.matches = false; listener!(); expect(apply).toHaveBeenLastCalledWith('light')
    controller.setMode('dark'); expect(storage.setItem).toHaveBeenCalledWith('flowerp-theme', 'dark')
    listener!(); expect(changed).toHaveBeenLastCalledWith('dark', 'dark')
    controller.setMode('light'); media.matches = true; listener!(); expect(apply).toHaveBeenLastCalledWith('light')
    controller.setMode('system'); expect(apply).toHaveBeenLastCalledWith('dark')
    controller.dispose(); expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
  })

  it('tolera fallos de lectura, escritura y ausencia de matchMedia sin perder el cambio', () => {
    const changed = vi.fn()
    const controller = createThemeController({ storage: () => { throw new Error('bloqueado') }, media: () => { throw new Error('ausente') }, apply: vi.fn() }, changed)
    controller.initialize(); expect(changed).toHaveBeenLastCalledWith('system', 'light')
    controller.setMode('dark'); expect(changed).toHaveBeenLastCalledWith('dark', 'dark')
    controller.dispose()
  })

  it('el script real aplica atributos, clase, esquema y meta antes del montaje, con y sin almacenamiento', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#F5F8FA">'
    for (const stored of ['light', 'dark', 'system', 'incorrecto', null]) for (const systemDark of [false, true]) {
      vi.stubGlobal('localStorage', { getItem: () => stored })
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: systemDark }) })
      new Function(themeBootstrap)()
      const expected = resolveTheme(stored, systemDark)
      expect(document.documentElement.dataset.theme).toBe(expected)
      expect(document.documentElement.classList.contains('dark')).toBe(expected === 'dark')
      expect(document.documentElement.style.colorScheme).toBe(expected)
      expect(document.querySelector('meta')?.getAttribute('content')).toBe(expected === 'dark' ? '#141B29' : '#F5F8FA')
    }
    vi.stubGlobal('localStorage', { getItem() { throw new Error('bloqueado') } })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
    expect(() => new Function(themeBootstrap)()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('selector real: teclado y accesibilidad', () => {
  async function mount() {
    const mode = ref<'system' | 'light' | 'dark'>('system')
    const setMode = vi.fn((value: typeof mode.value) => { mode.value = value })
    const component = compileVueComponent('components/ThemeSelector.vue', {}, { useTheme: () => ({ mode, setMode }) })
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(component) }); app.mount(host); apps.push(app)
    await nextTick()
    return { host, setMode, trigger: host.querySelector('button')! }
  }
  async function key(node: Element, value: string) { node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); await nextTick(); await nextTick() }
  it('abre por flecha, recorre opciones, selecciona y devuelve foco con Esc', async () => {
    const { host, trigger, setMode } = await mount()
    expect(trigger.getAttribute('aria-label')).toBe('Tema: Sistema')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    await key(trigger, 'ArrowDown')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const options = host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    expect(options).toHaveLength(3); expect(options[2]!.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(options[2])
    await key(options[2]!, 'ArrowDown'); expect(document.activeElement).toBe(options[0])
    await key(options[0]!, 'End'); expect(document.activeElement).toBe(options[2])
    await key(options[2]!, 'Home'); expect(document.activeElement).toBe(options[0])
    await key(options[0]!, 'ArrowDown'); options[1]!.click(); await nextTick()
    expect(setMode).toHaveBeenCalledWith('dark'); expect(trigger.getAttribute('aria-label')).toBe('Tema: Oscuro')
    expect(document.activeElement).toBe(trigger)
    trigger.click(); await nextTick(); await nextTick()
    await key(host.querySelector('[role="menu"]')!, 'Escape')
    expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger)
  })
  it('cierra con Tab y clic exterior y retira el listener al desmontar', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { host, trigger } = await mount()
    await key(trigger, 'ArrowUp')
    await key(host.querySelector('[role="menu"]')!, 'Tab')
    expect(host.querySelector('[role="menu"]')).toBeNull()
    trigger.click(); await nextTick(); document.body.click(); await nextTick()
    expect(host.querySelector('[role="menu"]')).toBeNull()
    apps.pop()!.unmount(); expect(remove).toHaveBeenCalledWith('click', expect.any(Function))
    remove.mockRestore()
  })
})
