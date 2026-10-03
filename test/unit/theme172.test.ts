// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, ref, Suspense, watch, type App, type Component } from 'vue'
import { readFileSync, readdirSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { darkTokens, lightTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight, themeBootstrap } from '../../utils/theme'
import { accessContrastPairs, isAccessContrast, themeContrasts } from '../helpers/themeContrast'
import { auditThemeColors, auditThemeSource, migratedThemeFiles } from '../../scripts/auditThemeColors'
import * as returnToRoute from '../../utils/returnToRoute'
import * as passwordPolicy from '../../server/utils/passwordPolicy'
import baseline from '../fixtures/themeBaseline172.json'
import colors from '../fixtures/themeAccess172.json'
import deficits from '../fixtures/themeAccessDeficits172.json'

const routes = ['login', 'registro', 'registro-completo', 'recuperar', 'restablecer/[token]', 'activar', 'verificar-correo', 'confirmar-correo', 'invitacion/[token]']
const protectedFiles = ['pages/dev/chattito.vue', 'pages/facturacion-print/[id].vue', 'pages/registros/[entity]/etiquetas/imprimir.vue', 'pages/registros/[entity]/reportes/vista-previa.vue', 'pages/registros/[entity]/reportes/[id]/imprimir.vue']
const apps: App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
type State = { error?: boolean; ready?: boolean; totp?: boolean; org?: boolean; missingToken?: boolean }
async function mount(route: string, mode: 'light' | 'dark', state: State = {}) {
  document.documentElement.dataset.theme = mode
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.style.colorScheme = mode
  document.body.dataset.contentTheme = 'inherit'
  const meta = vi.fn(), navigate = vi.fn(), fetchMe = vi.fn()
  const user = ref({ email: 'qa@ejemplo.invalid', onboardingStatus: state.ready ? 'complete' : 'email_pending' })
  const fetch = vi.fn(async (url: string) => {
    if (state.error) throw { data: { statusMessage: 'Error de prueba: enlace inválido o cuenta bloqueada' } }
    if (url === '/api/tenants/check-slug') return { available: true }
    if (url === '/api/auth/register') return { ok: true, tenantName: 'Prueba', slug: 'prueba', invitationsSent: 0 }
    if (url === '/api/auth/email-verification/change-email') return { email: 'nuevo@ejemplo.invalid' }
    if (['/api/auth/password-reset/request', '/api/auth/password-reset/confirm', '/api/users/accept-invitation', '/api/auth/email-verification/confirm', '/api/auth/email-verification/resend', '/api/license/activate'].includes(url)) return { ok: true }
    throw new Error(`Endpoint no simulado: ${url}`)
  })
  const login = vi.fn(async () => {
    if (state.error) throw { data: { statusMessage: 'Cuenta bloqueada: prueba' } }
    if (state.totp) return { requiresTotp: true, tempToken: 'temporal' }
    if (state.org) return { requiresOrgSelection: true, pendingToken: 'organizaciones', organizations: [{ tenantId: 'org', tenantName: 'Prueba' }] }
    return {}
  })
  const loginWithTotp = vi.fn(async () => ({})), selectOrganization = vi.fn(async () => ({}))
  const comp = compileVueComponent(`pages/${route}.vue`, { '~/utils/returnToRoute': returnToRoute, '~/server/utils/passwordPolicy': passwordPolicy }, {
    ref, computed, watch, onMounted, onBeforeUnmount, definePageMeta: meta, useHead: vi.fn(),
    useRoute: () => ({ params: { token: 'token-local' }, query: state.missingToken ? {} : { token: 'token-local' } }),
    useAuth: () => ({ user, fetchMe, login, loginWithTotp, selectOrganization }),
    useDeploymentConfig: async () => ({ data: ref({ appMode: 'shared' }) }), navigateTo: navigate, $fetch: fetch,
    useFetch: (url: string) => {
      if (url !== '/api/license/status') throw new Error(`useFetch no simulado: ${url}`)
      return { data: ref({ required: true, activated: !!state.ready, requestCode: 'LOCAL', customer: 'Prueba', expiresAt: '2027-01-01' }), refresh: vi.fn() }
    }
  })
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(comp) }) })
  const link: Component = { setup(_, { attrs, slots }) { return () => h('a', { ...attrs, href: attrs.to }, slots.default?.()) } }
  app.component('NuxtLink', link)
  const host = document.createElement('div'); document.body.append(host); apps.push(app); app.mount(host); await flush()
  return { host, meta, fetch, login, loginWithTotp, selectOrganization, navigate }
}
async function input(host: Element, id: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`#${id}`)!
  expect(el).toBeTruthy(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); await flush()
}
async function click(host: Element, text: string) {
  const el = [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.includes(text))!
  expect(el).toBeTruthy(); el.click(); await flush()
}
async function submit(host: Element) { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('HU-172: tokens, contraste y rutas', () => {
  it('conserva los 342 tokens previos y los ocho nuevos claros exactos', () => {
    expect(Object.keys(baseline.light)).toHaveLength(342)
    for (const [mode, values] of Object.entries(baseline)) for (const [key, value] of Object.entries(values)) expect((mode === 'light' ? lightTokens : darkTokens)[key as keyof typeof lightTokens]).toBe(value)
    expect(Object.keys(lightTokens).filter(key => !(key in baseline.light)).sort()).toEqual(Object.keys(colors).sort())
    const css = readFileSync('assets/css/theme.css', 'utf8')
    for (const [name, values] of Object.entries(colors)) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(values[0]); expect(darkTokens[name as keyof typeof lightTokens]).toBe(values[1])
      for (const value of values) expect(css).toContain(`--brand-${name}: ${rgbChannels(value!)};`)
      expect(css).toContain(`--brand-${name}: ${rgbChannels(values[0]!)} !important;`)
    }
  })
  it('exige AA a todos los pares oscuros y congela por separado déficits claros', () => {
    const results = themeContrasts().filter(isAccessContrast)
    expect(results.filter(v => v.theme === 'dark')).toHaveLength(accessContrastPairs.length)
    for (const v of results.filter(v => v.theme === 'dark')) expect(v.ratio, v.id).toBeGreaterThanOrEqual(v.minimum)
    expect(results.filter(v => v.theme === 'light' && v.ratio < v.minimum).map(v => [v.id, Number(v.ratio.toFixed(3)), v.minimum])).toEqual(deficits)
  })
  it('guardia cerrada cubre las nueve rutas y rechaza colores fijos', () => {
    expect(auditThemeColors()).toEqual([])
    for (const route of routes) {
      const file = `pages/${route}.vue`; expect(migratedThemeFiles).toContain(file)
      expect(auditThemeSource(file, '<p class="bg-white text-red-600" style="color:#fff"/>')).toHaveLength(3)
      expect(readFileSync(file, 'utf8')).not.toContain('theme-light')
    }
  })
  it('inventario exhaustivo deja solo documentos y diagnóstico protegidos', () => {
    const files = readdirSync('pages', { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.vue')).map(f => `pages/${f.replaceAll('\\', '/')}`)
    expect(files.filter(f => !readFileSync(f, 'utf8').includes('darkReady: true')).sort()).toEqual(protectedFiles.sort())
  })
  it('CSS inicial conserva gradiente claro, controles, foco y autocompletado oscuro', () => {
    const css = readFileSync('assets/css/access.css', 'utf8')
    expect(css).toContain('linear-gradient(200deg, rgb(var(--brand-access-start)) 0%, rgb(var(--brand-access-end)) 100%)')
    expect(css).toContain('color-scheme: inherit'); expect(css).toContain(':focus-visible')
    expect(css).toContain('input:-webkit-autofill:hover'); expect(css).toContain('input:-webkit-autofill:focus')
    expect(css).toContain('-webkit-text-fill-color: rgb(var(--brand-text)) !important')
    expect(css).toContain('1000px rgb(var(--brand-surface)) inset !important')
    expect(css).toContain(':root[data-theme=\'dark\']')
    expect(readFileSync('nuxt.config.ts', 'utf8')).toContain("'~/assets/css/access.css'")
    expect(readFileSync('nuxt.config.ts', 'utf8')).toContain('innerHTML: themeBootstrap')
  })
  it.each(routes)('arranque antes del montaje en /%s para claro, oscuro y sistema', route => {
    for (const mode of ['light', 'dark', 'system']) for (const systemDark of [false, true]) {
      const resolved = mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light'
      new Function('localStorage', 'window', 'document', themeBootstrap)({ getItem: () => mode }, { matchMedia: () => ({ matches: systemDark }) }, document)
      expect(document.documentElement.dataset.theme, route).toBe(resolved)
      expect(document.documentElement.style.colorScheme).toBe(resolved)
      expect(document.documentElement.classList.contains('dark')).toBe(resolved === 'dark')
      expect(contentNeedsLight({ layout: false, darkReady: true })).toBe(false)
    }
  })
})
describe.each(['light', 'dark'] as const)('acceso montado en %s sin red', mode => {
  it.each(routes)('monta /%s con tema heredado y metadata completa', async route => {
    const { host, meta } = await mount(route, mode)
    expect(host.querySelector('.access-page')).toBeTruthy(); expect(host.querySelector('.theme-light')).toBeNull()
    expect(meta).toHaveBeenCalledWith({ layout: false, darkReady: true })
    expect(host.textContent?.trim().length).toBeGreaterThan(15)
    if (host.querySelector('img')) expect(host.querySelector('img')?.getAttribute('src')).toBe('/brand/isotipo-white.png')
  })
  it('login conserva pasos password, TOTP y payload', async () => {
    const { host, login, loginWithTotp } = await mount('login', mode, { totp: true })
    await input(host, 'email', 'qa@ejemplo.invalid'); await input(host, 'password', 'Clave-local-1'); await submit(host)
    expect(login).toHaveBeenCalledWith('qa@ejemplo.invalid', 'Clave-local-1')
    expect(host.textContent).toContain('Verificación en dos pasos')
    await input(host, 'totpCode', '123456'); await submit(host)
    expect(loginWithTotp).toHaveBeenCalledWith('temporal', '123456')
  })
  it('login conserva organización, disabled y selección', async () => {
    const { host, selectOrganization } = await mount('login', mode, { org: true }); await submit(host)
    expect(host.textContent).toContain('Elige tu organización'); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    await click(host, 'Selecciona una organización')
    const option = [...host.querySelectorAll('button')].find(el => el.textContent?.trim() === 'Prueba')!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await flush(); await submit(host)
    expect(selectOrganization).toHaveBeenCalledWith('organizaciones', 'org')
  })
  it('login bloqueado conserva icono y texto de error', async () => {
    const { host } = await mount('login', mode, { error: true }); await submit(host)
    expect(host.textContent).toContain('Cuenta bloqueada: prueba'); expect(host.querySelector('.bg-brand-error-bg svg')).toBeTruthy()
  })
  it('registro recorre cuenta, organización, invitaciones y confirmación sin correo real', async () => {
    const { host, fetch } = await mount('registro', mode)
    await input(host, 'fullName', 'Prueba'); await input(host, 'email', 'qa@ejemplo.invalid')
    await input(host, 'password', 'Clave-local-1'); await input(host, 'confirmPassword', 'Clave-local-1')
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!; checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await flush()
    await click(host, 'Continuar'); expect(host.textContent).toContain('Crea tu organización')
    await input(host, 'organizationName', 'Prueba'); await click(host, 'Continuar'); expect(host.textContent).toContain('Invita a tu equipo')
    await click(host, 'Omitir por ahora'); expect(host.textContent).toContain('Confirma tu correo')
    expect(fetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ slug: 'prueba', invitees: undefined }) }))
  })
  it('recuperación presenta éxito sin exponer existencia de cuenta', async () => {
    const { host, fetch } = await mount('recuperar', mode); await input(host, 'email', 'qa@ejemplo.invalid'); await submit(host)
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Si el correo existe')
    expect(fetch).toHaveBeenCalledWith('/api/auth/password-reset/request', { method: 'POST', body: { email: 'qa@ejemplo.invalid' } })
  })
  it('restablecer conserva validación, error y éxito', async () => {
    const { host, fetch } = await mount('restablecer/[token]', mode)
    await input(host, 'password', 'Clave-local-1'); await input(host, 'confirmation', 'otra'); await submit(host)
    expect(host.textContent).toContain('Las contraseñas no coinciden'); expect(fetch).not.toHaveBeenCalled()
    await input(host, 'confirmation', 'Clave-local-1'); await submit(host); expect(host.textContent).toContain('Tu contraseña se restableció')
    expect(fetch).toHaveBeenCalledWith('/api/auth/password-reset/confirm', { method: 'POST', body: { token: 'token-local', password: 'Clave-local-1' } })
  })
  it('invitación conserva validación y activación', async () => {
    const { host, fetch } = await mount('invitacion/[token]', mode)
    await input(host, 'password', 'Clave-local-1'); await submit(host); expect(host.textContent).toContain('La confirmación no coincide'); expect(fetch).not.toHaveBeenCalled()
    await input(host, 'confirmPassword', 'Clave-local-1'); await submit(host); expect(host.textContent).toContain('Cuenta activada')
    expect(fetch).toHaveBeenCalledWith('/api/users/accept-invitation', { method: 'POST', body: { token: 'token-local', password: 'Clave-local-1', fullName: undefined } })
  })
  it('confirmar permite cambiar correo y muestra resultado textual', async () => {
    const { host, fetch } = await mount('confirmar-correo', mode); await click(host, 'Cambiar correo'); await input(host, 'new-email', 'nuevo@ejemplo.invalid'); await submit(host)
    expect(host.querySelector('[role="status"]')?.textContent).toContain('nuevo@ejemplo.invalid')
    expect(fetch).toHaveBeenCalledWith('/api/auth/email-verification/change-email', { method: 'PUT', body: { email: 'nuevo@ejemplo.invalid' } })
  })
  it('verificación inválida usa título, icono y enlace de recuperación', async () => {
    const { host, fetch } = await mount('verificar-correo', mode, { missingToken: true }); expect(fetch).not.toHaveBeenCalled()
    expect(host.textContent).toContain('No se pudo confirmar'); expect(host.textContent).toContain('El enlace no contiene un token válido')
  })
  it('registro completo muestra acceso al terminar y desmonta polling', async () => {
    const { host } = await mount('registro-completo', mode, { ready: true }); expect(host.textContent).toContain('Todo listo'); expect(host.querySelector('a')?.getAttribute('href')).toBe('/')
  })
})
