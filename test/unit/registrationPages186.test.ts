// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as intent from '../../utils/registrationIntent'
import { themeBootstrap } from '../../utils/theme'
import { auditThemeSource } from '../../scripts/auditThemeColors'
import { readFileSync } from 'node:fs'

const apps: vue.App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await vue.nextTick() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })
const plans = ['agenda', 'starter'].map(code => ({ code, key: code, name: code === 'starter' ? 'Starter' : 'Agenda', description: 'Plan', monthlyPriceCents: 69900, annualPriceCents: 699000, currency: 'MXN', limits: { users: 5, modules: 2 }, blockedBy: [] as unknown[] }))
async function mount(file: string, options: { choice?: boolean; blocked?: boolean; unavailable?: boolean; fail?: boolean } = {}) {
  const fetch = vi.fn(async (url: string) => {
    if (options.fail && url === '/api/billing/checkout') throw { data: { statusMessage: 'Checkout simulado ocupado' } }
    return { url: 'https://checkout.stripe.test/186' }
  })
  const navigate = vi.fn()
  const page = compileVueComponent(file, { '~/utils/registrationIntent': intent }, {
    ...vue, definePageMeta: vi.fn(), navigateTo: navigate, $fetch: fetch,
    useRoute: () => ({ query: { ...(options.choice ? { plan: 'starter', interval: 'year' } : {}), canceled: '1' } }),
    useState: () => vue.ref(null), useDeploymentConfig: async () => ({ data: vue.ref({ appMode: 'saas' }) }),
    useFetch: async () => ({ data: vue.ref({ plans: plans.map(plan => ({ ...plan, blockedBy: options.blocked ? ['users'] : [] })), intent: options.choice ? { plan: 'starter', interval: 'year' } : null, unavailable: options.unavailable }), error: vue.ref(null) })
  })
  const host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, {}, { default: () => vue.h(page) }) })
  app.component('NuxtLink', vue.defineComponent({ setup(_, { slots }) { return () => vue.h('a', {}, slots.default?.()) } }))
  app.mount(host); apps.push(app); await flush()
  return { host, fetch, navigate }
}
function button(host: Element, text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.includes(text))
  expect(button).toBeTruthy()
  return button!
}
it.each(['light', 'dark', 'system'] as const)('registro con resumen y sin él funciona en %s', async mode => {
  new Function('localStorage', 'window', 'document', themeBootstrap)({ getItem: () => mode }, { matchMedia: () => ({ matches: true }) }, document)
  const { host, navigate } = await mount('pages/registro.vue', { choice: true })
  expect(host.querySelector('[aria-label="Plan elegido"]')?.textContent).toContain('Starter')
  expect(host.textContent).toContain('$6,990 MXN al año')
  expect(host.querySelector('#email')).toBeTruthy()
  button(host, 'Cambiar plan').click(); await flush()
  expect(host.querySelector('[aria-label="Plan elegido"]')).toBeNull()
  expect(navigate).toHaveBeenCalledWith('/registro', { replace: true })
  const normal = await mount('pages/registro.vue')
  expect(normal.host.querySelector('[aria-label="Plan elegido"]')).toBeNull()
  expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
  expect(auditThemeSource('pages/registro.vue', readFileSync('pages/registro.vue', 'utf8'))).toEqual([])
})
it.each(['light', 'dark', 'system'] as const)('preselección anual, cambio de plan e intervalo y errores en %s', async mode => {
  new Function('localStorage', 'window', 'document', themeBootstrap)({ getItem: () => mode }, { matchMedia: () => ({ matches: true }) }, document)
  const { host, fetch } = await mount('pages/elegir-plan.vue', { choice: true, fail: true })
  expect(fetch).not.toHaveBeenCalled()
  const selected = [...host.querySelectorAll('article')].find(article => article.textContent?.includes('Starter'))!
  expect(selected.className).toContain('ring-brand-blue')
  expect(selected.textContent).toContain('Elegiste este plan desde nuestra página')
  button(host, 'Continuar al pago').click(); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/billing/checkout', { method: 'POST', body: { planCode: 'starter', interval: 'year' } })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Checkout simulado ocupado')
  button(host, 'Cambiar a este plan').click(); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/billing/registration-intent', { method: 'POST', body: { clear: true } })
  button(host, 'Mensual').click(); await flush()
  button(host, 'Continuar al pago').click(); await flush()
  expect(fetch).toHaveBeenLastCalledWith('/api/billing/checkout', { method: 'POST', body: { planCode: 'agenda', interval: 'month' } })
  expect(auditThemeSource('pages/elegir-plan.vue', readFileSync('pages/elegir-plan.vue', 'utf8'))).toEqual([])
})
it('respeta blockedBy, cancelación y aviso de plan no disponible', async () => {
  const { host, fetch } = await mount('pages/elegir-plan.vue', { choice: true, blocked: true, unavailable: true })
  expect(button(host, 'Continuar al pago').disabled).toBe(true)
  expect(host.textContent).toContain('No se completó Checkout')
  expect(host.textContent).toContain('El plan elegido ya no está disponible')
  expect(fetch).not.toHaveBeenCalled()
})
