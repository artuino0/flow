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
it.each(['light', 'dark', 'system'] as const)('dominios en tema %s: estados, DNS, accesibilidad y proveedores', async mode => {
  const states = new Map<string, ReturnType<typeof ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key) })
  vi.stubGlobal('useNuxtApp', () => ({}))
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  const theme = useTheme(); theme.initialize(); theme.setMode(mode)
  expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
  const dns = [{ type: 'CNAME', name: 'www', value: 'customers.flow.test', purpose: 'routing' }, { type: 'TXT', name: '_cf-custom-hostname.www', value: 'ownership-token', purpose: 'ownership' }]
  const domains = [
    { id: 'active', hostname: 'www.activo.test', status: 'active', providerName: 'cloudflare', providerData: { cloudflare: { managedByZone: true, dnsVerified: true, edgeVerified: true } }, dnsVerified: true },
    { id: 'dns', hostname: 'cliente.test', status: 'pending', providerName: 'cloudflare', providerData: { cloudflare: { managedByZone: true, dnsVerified: false, edgeVerified: false } }, dnsVerified: false },
    { id: 'connection', hostname: 'www.cliente.test', status: 'pending', providerName: 'cloudflare', providerData: { cloudflare: { managedByZone: true, dnsVerified: true, edgeVerified: false } }, dnsVerified: true },
    { id: 'error', hostname: 'error.test', status: 'error', providerName: 'cloudflare', validationError: 'Revisa los registros DNS de validación.', dnsVerified: false },
    { id: 'railway', hostname: 'www.railway.test', status: 'pending', providerName: 'railway', dnsVerified: false },
    { id: 'vercel', hostname: 'www.vercel.test', status: 'pending', providerName: 'vercel', dnsVerified: false }
  ].map((domain, index) => ({ siteId: 's', siteName: 'Sitio', isPrimary: false, rootPageId: null, rootPageTitle: null, recordType: index === 1 ? 'apex' : 'subdomain', ownershipVerified: false, certificateVerified: false, lastCheckedAt: null, providerConfigured: true, dnsRecords: dns, ...domain }))
  const fetcher = vi.fn(async (url: string) => url.includes('/verify') ? ({ status: 'pending', providerData: { cloudflare: { managedByZone: true, dnsVerified: true, edgeVerified: false } } }) : undefined)
  const copy = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  const globals = { ref, computed, reactive, watch, useConfirm: () => ({ confirm: async () => true }), useRequestHeaders: () => ({}), $fetch: fetcher,
    useFetch: async (input: unknown) => ({ data: ref(String(unref(input)) === '/api/sites' ? { sites: [{ id: 's', name: 'Sitio', slug: 'sitio' }] } : { domains }), pending: ref(false), error: ref(null), refresh: vi.fn() }) }
  const component = compileVueComponent('components/SitesDomainManager.vue', {}, globals, { client: true, server: false, dev: false })
  const host = document.createElement('div'); document.body.append(host)
  app = createApp({ render: () => h(Suspense, {}, { default: () => h(component) }) })
  app.component('ListPageHeader', defineComponent({ setup(_, { slots }) { return () => h('header', slots.actions?.()) } })); app.mount(host)
  await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  const activeRow = host.querySelector('.domain-block')!
  expect(activeRow.textContent).toContain('Tu dominio está conectado y funcionando')
  expect(activeRow.querySelector<HTMLElement>('.dns-panel')!.style.display).toBe('none')
  const toggle = activeRow.querySelector<HTMLButtonElement>('.dns-toggle')!
  expect(toggle.textContent).toContain('Ver registros DNS'); expect(toggle.getAttribute('aria-expanded')).toBe('false')
  toggle.focus(); expect(document.activeElement).toBe(toggle); toggle.click(); await nextTick()
  expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(activeRow.querySelector('.dns-panel'))
  expect(host.textContent).toContain('Falta configurar el DNS')
  expect(host.textContent).toContain('Comprobando conexión segura')
  expect(host.textContent).toContain('Hay un problema')
  expect(host.textContent).toContain('Revisa los registros DNS de validación.')
  expect(host.textContent).toContain('Tu dominio no lleva «www».')
  expect(host.textContent).not.toContain('www.railway.test hacia')
  expect(host.textContent).not.toContain('Emitiendo certificado')
  expect(host.textContent).not.toContain('Custom Hostname')
  expect(host.textContent).not.toContain('CNAME aplanado')
  expect(host.querySelectorAll('.dns-record')).toHaveLength(8)
  const copyButton = host.querySelector<HTMLButtonElement>('.dns-record label button')!
  copyButton.click(); await nextTick(); expect(copy).toHaveBeenCalledWith('www')
  const verifyButton = Array.from(host.querySelectorAll<HTMLButtonElement>('.dns-intro .primary')).find(button => button.textContent?.includes('Comprobar de nuevo'))!
  verifyButton.click(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  expect(fetcher).toHaveBeenCalledWith('/api/sites/domains/dns/verify', { method: 'POST' })
  expect(host.textContent).toContain('El registro está bien, pero la conexión segura todavía no responde.')
  expect(host.querySelectorAll('.dns-intro .primary')).toHaveLength(5)
  expect(auditThemeColors()).toEqual([])
  expect(readFileSync('pages/sites/domains/index.vue', 'utf8')).toContain('darkReady: true')
  expect(lightTokens['sites-warning-text']).toBeDefined(); expect(darkTokens['sites-warning-text']).toBeDefined()
  theme.dispose()
})
