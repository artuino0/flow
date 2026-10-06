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
async function mount(mode: string, width: number, failed = false, codeFailure?: string, retryAfter = 0, queued = false) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  new Function('localStorage', 'window', 'document', themeBootstrap)({ getItem: () => mode }, { matchMedia: () => ({ matches: true }) }, document)
  const user = vue.ref({ email: 'person195@local.test' }), navigate = vi.fn(), fetchMe = vi.fn(), refresh = vi.fn()
  const fetch = vi.fn(async (url: string, options?: { body?: { email?: string } }) => {
    if (url.endsWith('/code') && (failed || codeFailure)) throw { data: { statusMessage: codeFailure || 'El código no es válido o ya venció.' } }
    if (url.endsWith('/change-email')) { user.value.email = options!.body!.email!; return { email: user.value.email } }
    return { ok: true }
  })
  const meta = vi.fn()
  const page = compileVueComponent('pages/confirmar-correo.vue', {}, { ...vue, definePageMeta: meta, $fetch: fetch, navigateTo: navigate,
    useAuth: () => ({ user, fetchMe }), useFetch: async () => ({ data: vue.ref({ delivery: failed ? 'failed' : queued ? 'queued' : 'sent', retryAfter: failed ? 0 : retryAfter }), refresh }) })
  const theme = compileVueComponent('components/ThemeSelector.vue', {}, { useTheme: () => ({ mode: vue.ref(mode), setMode: vi.fn() }) })
  const otpStep = compileVueComponent('components/RegistrationOtpStep.vue')
  const stepIndicator = compileVueComponent('components/RegistrationStepIndicator.vue')
  const host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, {}, { default: () => vue.h(page) }) }); app.component('ThemeSelector', theme)
  app.component('RegistrationOtpStep', otpStep); app.component('RegistrationStepIndicator', stepIndicator)
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
  expect(host.querySelectorAll('button[aria-label^="Tema:"]')).toHaveLength(1)
  const themeButton = host.querySelector<HTMLButtonElement>('button[aria-label^="Tema:"]')!
  expect(themeButton.closest('.fixed')?.className).toBe('fixed right-4 top-4 z-50')
  expect(themeButton.closest('form')).toBeNull()
  expect(themeButton.classList.contains('h-11') && themeButton.classList.contains('w-11')).toBe(true)
  expect(themeButton.classList.contains('bg-brand-surface')).toBe(true)
  themeButton.click(); await flush()
  expect(host.querySelector('[role="menu"][aria-label="Tema de la aplicación"]')).toBeTruthy()
  themeButton.click(); await flush()
  const code = host.querySelector<HTMLInputElement>('#verification-code')!
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Paso 2 de 5: Verifica tu correo')
  const steps = [...host.querySelectorAll<HTMLElement>('[role="progressbar"] > .rounded-full')]
  expect(steps[0].className).toContain('bg-brand-orange')
  expect(steps[0].querySelector('svg')).toBeTruthy()
  expect(host.querySelector('.access-brand.lg\\:hidden')?.textContent).toContain('9:41')
  expect(code.getAttribute('inputmode')).toBe('numeric'); expect(code.autocomplete).toBe('one-time-code')
  expect(host.querySelector('label[for="verification-code"]')).toBeTruthy()
  expect(host.querySelectorAll('#verification-code')).toHaveLength(1)
  const slots = host.querySelector('#verification-code')?.parentElement?.querySelectorAll('span')
  expect(slots).toHaveLength(6)
  expect(slots?.[0].className).toContain('h-14')
  expect(button(host, 'Verificar correo').disabled).toBe(true)
  await input(host, 'verification-code', '123456')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/auth/email-verification/code', { method: 'POST', body: { code: '123456' } })
  expect(fetchMe).toHaveBeenCalled(); expect(navigate).toHaveBeenCalledWith('/elegir-plan')
  expect(auditThemeSource('pages/confirmar-correo.vue', readFileSync('pages/confirmar-correo.vue', 'utf8'))).toEqual([])
})
it.each(['El código no es válido.', 'El código caducó. Solicita otro.', 'Se agotaron los intentos. Solicita un código nuevo.'])('muestra el error del servicio sin perder el estado de entrada: %s', async errorMessage => {
  const { host } = await mount('dark', 390, false, errorMessage)
  await input(host, 'verification-code', '123456')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(host.querySelector('#verification-error')?.textContent).toBe(errorMessage)
  expect(host.querySelector('#verification-error')?.getAttribute('role')).toBe('alert')
})
it('muestra el estado de reenvío en espera al recuperar la cuenta', async () => {
  const { host } = await mount('light', 390, false, '', 42, true)
  expect(button(host, 'Reenviar código en 0:42').disabled).toBe(true)
  expect(host.textContent).toContain('El envío está pendiente.')
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
  button(host, 'Usar otro correo').click(); await flush(); await input(host, 'new-email', 'changed195@local.test')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/auth/email-verification/change-email', { method: 'PUT', body: { email: 'changed195@local.test' } })
  expect(button(host, 'Reenviar código en 1:00').disabled).toBe(true)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('changed195@local.test')
})
