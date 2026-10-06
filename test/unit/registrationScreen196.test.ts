// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as intent from '../../utils/registrationIntent'
import { themeBootstrap } from '../../utils/theme'

const apps: vue.App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await vue.nextTick() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })

async function mountSlugScenario(check: { available: boolean; reason?: string }) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/tenants/check-slug') return check
    if (url === '/api/auth/register') return { tenantName: 'Acme', slug: 'acme', invitationsSent: 0 }
    throw new Error(`Endpoint no simulado: ${url}`)
  })
  const page = compileVueComponent('pages/registro.vue', { '~/utils/registrationIntent': intent }, {
    ...vue, definePageMeta: vi.fn(), navigateTo: vi.fn(), $fetch: fetch,
    useRoute: () => ({ query: {} }), useState: () => vue.ref(null),
    useDeploymentConfig: async () => ({ data: vue.ref({ appMode: 'saas', appBaseUrl: 'https://app.dydasoftware.com' }) })
  })
  const host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, {}, { default: () => vue.h(page) }) })
  app.component('NuxtLink', vue.defineComponent({ props: ['to'], setup(_, { slots }) { return () => vue.h('a', {}, slots.default?.()) } }))
  app.component('RegistrationStepIndicator', compileVueComponent('components/RegistrationStepIndicator.vue'))
  app.component('ThemeSelector', { render: () => null })
  app.mount(host); apps.push(app); await flush()
  return { host, fetch }
}

async function input(host: Element, selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(selector)!
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); await flush()
}
function button(host: Element, text: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(text))! }

it('identificador disponible permite continuar y el resumen separa el acceso real del identificador', async () => {
  const { host, fetch } = await mountSlugScenario({ available: true })
  const steps = [...host.querySelectorAll<HTMLElement>('[role="progressbar"] > .rounded-full')]
  expect(steps).toHaveLength(5)
  expect(steps[0].className).toContain('h-[26px]')
  await input(host, '#fullName', 'Ana Pérez'); await input(host, '#email', 'ana@example.com')
  await input(host, '#password', 'clave1234'); await input(host, '#confirmPassword', 'clave1234')
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Paso 1 de 5: Tu cuenta')
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await flush(); button(host, 'Continuar').click(); await flush()
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Paso 3 de 5: Tu organización')
  await input(host, '#organizationName', 'Acme'); await new Promise(resolve => setTimeout(resolve, 450)); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/tenants/check-slug', { query: { slug: 'acme' } })
  expect(host.textContent).toContain('Disponible')
  expect(host.textContent).toContain('Un nombre corto y único, en minúsculas.')
  button(host, 'Continuar').click(); await flush()
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Paso 4 de 5: Invita a tu equipo')
  expect(button(host, 'Agregar otro correo').className).toContain('w-full')
  button(host, 'Continuar').click(); await flush()
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Paso 5 de 5: Listo')
  expect(host.querySelector('div.bg-brand-bg')).toBeTruthy()
  const completed = [...host.querySelectorAll<HTMLElement>('[role="progressbar"] > .rounded-full')]
  expect(completed).toHaveLength(5)
  expect(completed.every(node => node.className.includes('bg-brand-orange') && node.querySelector('svg'))).toBe(true)
  expect(host.textContent).toContain('Identificador')
  expect(host.textContent).toContain('acme')
  expect(host.textContent).toContain('Acceso')
  expect(host.textContent).toContain('app.dydasoftware.com')
  expect(host.textContent).not.toMatch(/erpdinamico\.com|flowerp\.com|FlowERP|ERP Dinámico/i)
})

it.each([
  [{ available: false }, 'Ese identificador ya está en uso, prueba con otro.'],
  [{ available: false, reason: 'formato' }, 'Usa solo letras minúsculas, números y guiones']
] as const)('muestra el error del identificador sin avanzar: %j', async (check, message) => {
  const { host } = await mountSlugScenario(check)
  await input(host, '#fullName', 'Ana Pérez'); await input(host, '#email', 'ana@example.com')
  await input(host, '#password', 'clave1234'); await input(host, '#confirmPassword', 'clave1234')
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await flush(); button(host, 'Continuar').click(); await flush()
  await input(host, '#organizationName', 'Acme'); await new Promise(resolve => setTimeout(resolve, 450)); await flush()
  expect(host.textContent).toContain(message)
  expect(button(host, 'Continuar').disabled).toBe(true)
})

it.each(['light', 'dark', 'system'] as const)('registro conserva sus tokens en tema %s', async mode => {
  new Function('localStorage', 'window', 'document', themeBootstrap)({ getItem: () => mode }, { matchMedia: () => ({ matches: true }) }, document)
  const { host } = await mountSlugScenario({ available: true })
  await input(host, '#fullName', 'Ana Pérez'); await input(host, '#email', 'ana@example.com')
  await input(host, '#password', 'clave1234'); await input(host, '#confirmPassword', 'clave1234')
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await flush()
  button(host, 'Continuar').click(); await flush()
  expect(host.querySelector('#slug-help')).toBeTruthy()
  expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
})
