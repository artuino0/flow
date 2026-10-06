// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { themeBootstrap } from '../../utils/theme'
import { auditThemeSource } from '../../scripts/auditThemeColors'
const apps: vue.App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await vue.nextTick() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers() })
async function mount(mode: string, width: number, failed = false) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  new Function('localStorage', 'window', 'document', themeBootstrap)({ getItem: () => mode }, { matchMedia: () => ({ matches: true }) }, document)
  const user = vue.ref({ email: 'person195@local.test' }), navigate = vi.fn(), fetchMe = vi.fn(), refresh = vi.fn()
  const fetch = vi.fn(async (url: string, options?: { body?: { email?: string } }) => {
    if (url.endsWith('/code') && failed) throw { data: { statusMessage: 'El código no es válido o ya venció.' } }
    if (url.endsWith('/change-email')) { user.value.email = options!.body!.email!; return { email: user.value.email } }
    return { ok: true }
  })
  const meta = vi.fn()
  const page = compileVueComponent('pages/confirmar-correo.vue', {}, { ...vue, definePageMeta: meta, $fetch: fetch, navigateTo: navigate,
    useAuth: () => ({ user, fetchMe }), useFetch: async () => ({ data: vue.ref({ delivery: failed ? 'failed' : 'sent', retryAfter: 0 }), refresh }) })
  const theme = compileVueComponent('components/ThemeSelector.vue', {}, { useTheme: () => ({ mode: vue.ref(mode), setMode: vi.fn() }) })
  const host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, {}, { default: () => vue.h(page) }) }); app.component('ThemeSelector', theme)
  apps.push(app); app.mount(host); await flush()
  return { host, fetch, navigate, fetchMe, meta, refresh }
}
const scenarios = ['light', 'dark', 'system'].flatMap(mode => [390, 1440].map(width => ({ mode, width })))
function button(host: Element, label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(label))! }
async function input(host: Element, id: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`#${id}`)!; el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); await flush()
}
it.each(scenarios)('OTP accesible y continuación con tema $mode a $width', async ({ mode, width }) => {
  const { host, fetch, navigate, fetchMe, meta } = await mount(mode, width)
  expect(meta).toHaveBeenCalledWith({ layout: false, darkReady: true })
  const code = host.querySelector<HTMLInputElement>('#verification-code')!
  expect(code.getAttribute('inputmode')).toBe('numeric'); expect(code.autocomplete).toBe('one-time-code')
  expect(host.querySelector('label[for="verification-code"]')).toBeTruthy()
  expect(host.querySelectorAll('#verification-code')).toHaveLength(1)
  await input(host, 'verification-code', '123456')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/auth/email-verification/code', { method: 'POST', body: { code: '123456' } })
  expect(fetchMe).toHaveBeenCalled(); expect(navigate).toHaveBeenCalledWith('/elegir-plan')
  expect(auditThemeSource('pages/confirmar-correo.vue', readFileSync('pages/confirmar-correo.vue', 'utf8'))).toEqual([])
})
it('sigue consultando fallos tardíos de invitaciones aunque el código ya se haya enviado', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const { refresh } = await mount('dark', 390)
  await vi.advanceTimersByTimeAsync(5000)
  expect(refresh).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(5000)
  expect(refresh).toHaveBeenCalledTimes(2)
})
it.each(scenarios)('error verdadero, reenvío limitado y cambio de correo en $mode a $width', async ({ mode, width }) => {
  const { host, fetch, navigate } = await mount(mode, width, true)
  expect(host.textContent).toContain('Tu organización ya está creada')
  expect(host.textContent).toContain('No pudimos enviar el código; reenvíalo')
  await input(host, 'verification-code', '123456')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(host.querySelector('#verification-error')?.getAttribute('role')).toBe('alert'); expect(navigate).not.toHaveBeenCalled()
  button(host, 'Cambiar correo').click(); await flush(); await input(host, 'new-email', 'changed195@local.test')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/auth/email-verification/change-email', { method: 'PUT', body: { email: 'changed195@local.test' } })
  expect(button(host, 'Reenviar en 60 s').disabled).toBe(true)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('changed195@local.test')
})
