import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { loadNuxtSource183 } from '../helpers/nuxt183'
import * as flowApps from '../../utils/flowApps'

function harness(authenticated = false, contracted = false, verified = true) {
  const state = new Map<string, ReturnType<typeof ref>>()
  const user = ref(authenticated ? { authenticated: true, isAdmin: true, emailVerified: verified, onboardingStatus: contracted ? 'complete' : 'plan_pending' } : null)
  const fetch = vi.fn(async (url: string) => url === '/api/license/status' ? { required: false, activated: false } : { intent: contracted ? null : { plan: 'starter', interval: 'year' } })
  const navigate = vi.fn((path: unknown) => path)
  const globals = {
    useState: (key: string, init: () => unknown) => { if (!state.has(key)) state.set(key, ref(init())); return state.get(key) },
    useAuth: () => ({ user, fetchMe: vi.fn() }), useFlowAppAccess: () => ({ load: async () => ({ apps: [{ key: 'inicio', enabled: true, accessible: true }] }) }),
    $fetch: fetch, useRequestFetch: () => fetch, navigateTo: navigate, useRealtime: () => ({ resumeSession() {} }), defineNuxtRouteMiddleware: (fn: unknown) => fn
  }
  const middleware = loadNuxtSource183('middleware/auth.global.ts', globals, { '~/utils/flowApps': flowApps }).default
  const route = (path: string, query: Record<string, string> = {}) => ({ path, fullPath: path, query })
  return { state, user, middleware, route, fetch, navigate }
}
it('conserva entrada anónima hasta login y liga la elección a la organización autenticada', async () => {
  const h = harness()
  await h.middleware(h.route('/registro', { plan: 'starter', interval: 'year', price: '1' }))
  await h.middleware(h.route('/login'))
  expect(h.fetch).not.toHaveBeenCalledWith('/api/billing/registration-intent', expect.anything())
  h.user.value = { authenticated: true, isAdmin: true, emailVerified: true, onboardingStatus: 'plan_pending' }
  await h.middleware(h.route('/'))
  expect(h.fetch).toHaveBeenCalledWith('/api/billing/registration-intent', { method: 'POST', body: { plan: 'starter', interval: 'year' } })
  expect(h.navigate).toHaveBeenLastCalledWith('/elegir-plan')
  expect(h.state.get('registration-landing-choice')?.value).toBeNull()
})
it('sesión actual pasa del registro a onboarding; no pierde el plan al confirmar correo', async () => {
  const h = harness(true, false, false)
  await h.middleware(h.route('/registro', { plan: 'starter', interval: 'year' }))
  expect(h.navigate).toHaveBeenLastCalledWith('/confirmar-correo')
  expect(h.fetch).toHaveBeenCalledWith('/api/billing/registration-intent', expect.objectContaining({ method: 'POST' }))
  h.user.value!.emailVerified = true
  await h.middleware(h.route('/confirmar-correo'))
  expect(h.navigate).toHaveBeenLastCalledWith('/elegir-plan')
})
it('el redirect SSR de una sesión actual persiste antes de abrir la siguiente request', async () => {
  const h = harness(true)
  h.user.value!.onboardingStatus = 'complete'
  await h.middleware(h.route('/registro', { plan: 'starter', interval: 'year' }))
  expect(h.fetch).toHaveBeenCalledWith('/api/billing/registration-intent', { method: 'POST', body: { plan: 'starter', interval: 'year' } })
  expect(h.navigate).toHaveBeenLastCalledWith('/elegir-plan')
  const next = harness(true)
  next.user.value!.onboardingStatus = 'complete'
  await next.middleware(next.route('/elegir-plan'))
  expect(next.fetch).toHaveBeenCalledWith('/api/billing/registration-intent')
  expect(next.navigate).not.toHaveBeenCalled()
})
it('una suscripción contratada ignora la elección y no fuerza elegir plan', async () => {
  const h = harness(true, true)
  await h.middleware(h.route('/login', { plan: 'starter', interval: 'year' }))
  expect(h.navigate).not.toHaveBeenCalledWith('/elegir-plan')
  expect(h.navigate).toHaveBeenLastCalledWith('/ajustes?section=plan')
})
it('una cuenta completa sin contratación ve el selector y aviso al retirarse su plan guardado', async () => {
  const h = harness(true)
  h.user.value!.onboardingStatus = 'complete'
  h.fetch.mockImplementation(async url => url === '/api/license/status' ? { required: false, activated: false } : { intent: null, unavailable: true })
  await h.middleware(h.route('/elegir-plan'))
  expect(h.navigate).not.toHaveBeenCalled()
  expect(h.state.get('registration-plan-unavailable')?.value).toBe(true)
})
