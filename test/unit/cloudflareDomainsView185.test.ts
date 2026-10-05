// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, Suspense, ref, computed, reactive, watch, nextTick, unref, type App } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import { useTheme } from '../../composables/useTheme'
import { readFileSync } from 'node:fs'
import { lightTokens, darkTokens } from '../../utils/themeTokens'
import { auditThemeColors } from '../../scripts/auditThemeColors'

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each(['light', 'dark', 'system'] as const)('dominios Cloudflare en %s: estados, DNS, copiar y verificar', async mode => {
  const states = new Map<string, ReturnType<typeof ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key) })
  vi.stubGlobal('useNuxtApp', () => ({}))
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  const theme = useTheme(); theme.initialize(); theme.setMode(mode)
  expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
  const dns = [{ type: 'CNAME', name: 'www', value: 'customers.flow.test', purpose: 'routing' }, { type: 'TXT', name: '_cf-custom-hostname.www', value: 'ownership-token', purpose: 'ownership' }]
  const domains = ['dns', 'certificate', 'active', 'error'].map((state, index) => ({ id: 'd' + index, siteId: 's', siteName: 'Sitio', hostname: index === 0 ? 'cliente.test' : `www${index}.cliente.test`, status: state === 'active' ? 'active' : 'pending', providerName: 'cloudflare', providerConfigured: true, ownershipVerified: state !== 'dns', certificateVerified: state === 'active', verificationState: state, validationError: state === 'error' ? 'Revisa los registros DNS de validación.' : null, dnsRecords: dns }))
  const fetcher = vi.fn(async () => ({ ...domains[0], status: 'active' }))
  const copy = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  const globals = { ref, computed, reactive, watch, useConfirm: () => ({ confirm: async () => true }), useRequestHeaders: () => ({}), $fetch: fetcher,
    useFetch: async (input: unknown) => ({ data: ref(String(unref(input)) === '/api/sites' ? { sites: [{ id: 's', name: 'Sitio', slug: 'sitio' }] } : { domains }), pending: ref(false), error: ref(null), refresh: vi.fn() }) }
  const component = compileVueComponent('components/SitesDomainManager.vue', {}, globals, { client: true, server: false, dev: false })
  const host = document.createElement('div'); document.body.append(host)
  app = createApp({ render: () => h(Suspense, {}, { default: () => h(component) }) })
  app.component('ListPageHeader', defineComponent({ setup(_, { slots }) { return () => h('header', slots.actions?.()) } })); app.mount(host)
  await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  for (const text of ['Esperando DNS', 'Emitiendo certificado', 'Activo', 'Error:', 'Propiedad:', 'Certificado:', 'CNAME aplanado o ALIAS', 'www', 'Verificar ahora']) expect(host.textContent).toContain(text)
  expect(host.querySelectorAll('.dns-record')).toHaveLength(8)
  host.querySelector<HTMLButtonElement>('.dns-record label button')!.click(); await nextTick(); expect(copy).toHaveBeenCalledWith('www')
  host.querySelector<HTMLButtonElement>('button[aria-label="Verificar ahora"]')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  expect(fetcher).toHaveBeenCalledWith('/api/sites/domains/d0/verify', { method: 'POST' })
  expect(host.textContent).toContain('cliente.test quedó activo.')
  expect(auditThemeColors()).toEqual([])
  expect(readFileSync('pages/sites/domains/index.vue', 'utf8')).toContain('darkReady: true')
  expect(lightTokens['sites-warning-text']).toBeDefined(); expect(darkTokens['sites-warning-text']).toBeDefined()
  theme.dispose()
})
