// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as intent from '../../utils/registrationIntent'
import { themeBootstrap } from '../../utils/theme'
const apps: vue.App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve,0)); await vue.nextTick() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); sessionStorage.clear(); document.body.innerHTML=''; vi.restoreAllMocks() })
async function mount(verified = false, fail = false, pending = true, selectedFromQuery = false) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/auth/register/status') return { pending, verified, email: 'ana@local.test', fullName: 'Ana', registrationChoice: { plan: 'agenda', interval: 'year' }, retryAfter: 0, delivery: 'queued' }
    if (url === '/api/auth/register/start') return { retryAfter: 60, delivery: 'queued' }
    if (url === '/api/tenants/check-slug') return { available: true }
    if (url === '/api/auth/register/change-email') return { email: 'otra@local.test', retryAfter: 60, delivery: 'queued' }
    if (url === '/api/auth/register/verify' && fail) throw { data: { statusMessage: 'El código no es válido o ya venció. Solicita uno nuevo.' } }
    if (url === '/api/auth/register/verify') return { ok: true }
    if (url === '/api/auth/register') return { tenantName: 'Acme', slug: 'acme', invitationsSent: 1 }
    throw new Error('Endpoint no simulado: '+url)
  })
  const navigate = vi.fn()
  const page = compileVueComponent('pages/registro.vue', { '~/utils/registrationIntent': intent }, { ...vue,
    definePageMeta: vi.fn(), $fetch: fetch, navigateTo: navigate, useAuth: () => ({ fetchMe: vi.fn() }),
    useRoute: () => ({ query: selectedFromQuery ? { plan: 'agenda', interval: 'year' } : {} }), useState: () => vue.ref(null), useDeploymentConfig: async () => ({ data: vue.ref({ appMode: 'saas', appBaseUrl: 'https://flow.local.test' }) }),
    useFetch: async () => ({ data: vue.ref({ plans: [{ key:'agenda',name:'Agenda',monthlyPriceCents:69900,annualPriceCents:699000,currency:'MXN' }] }) })
  })
  const host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense,{}, { default: () => vue.h(page) }) })
  for (const name of ['RegistrationStepIndicator','RegistrationOtpStep','RegistrationChosenPlan']) app.component(name,compileVueComponent(`components/${name}.vue`))
  app.component('ThemeSelector',compileVueComponent('components/ThemeSelector.vue',{}, { useTheme: () => ({ mode:vue.ref('system'),setMode:vi.fn() }) })); app.component('NuxtLink',{ render: () => null })
  app.mount(host); apps.push(app); await flush(); await flush()
  return { host, fetch, navigate, app }
}
function button(host: Element,text: string) { const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(text)); expect(value).toBeTruthy(); return value! }
async function input(host: Element,selector: string,value: string) { const item=host.querySelector<HTMLInputElement>(selector)!; expect(item).toBeTruthy(); item.value=value; item.dispatchEvent(new Event('input',{ bubbles:true })); await flush() }
function expectPlanBeforeStep(host: Element, step: number) {
  const cards = host.querySelectorAll('[aria-label="Plan elegido"]')
  const card = cards[0], indicator = host.querySelector('[role="progressbar"]')
  expect(cards).toHaveLength(1)
  expect(indicator?.getAttribute('aria-valuenow')).toBe(String(step))
  expect(card!.compareDocumentPosition(indicator!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}
it.each(['light','dark','system'] as const)('recarga paso 2 y conserva plan anual sin contraseña en %s, 390/1440', async mode => {
  new Function('localStorage','window','document',themeBootstrap)({ getItem: () => mode },{ matchMedia: () => ({ matches:true }) },document)
  for (const width of [390,1440]) {
    Object.defineProperty(window,'innerWidth',{ configurable:true,value:width })
    const { host, app } = await mount()
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2')
    expect(host.querySelector('[aria-label="Plan elegido"]')?.textContent).toContain('Agenda · $6,990 MXN al año')
    expect(host.querySelector('#password')).toBeNull(); expect(host.querySelector('#organizationName')).toBeNull()
    expect(host.textContent).not.toContain('Tu organización ya está creada')
    const code=host.querySelector<HTMLInputElement>('#verification-code')!
    expect(code.getAttribute('inputmode')).toBe('numeric'); expect(code.autocomplete).toBe('one-time-code')
    expect(document.documentElement.dataset.theme).toBe(mode==='light'?'light':'dark')
    expect(host.querySelectorAll('button[aria-label^="Tema:"]')).toHaveLength(1)
    const themeButton=host.querySelector<HTMLButtonElement>('button[aria-label^="Tema:"]')!
    expect(themeButton.closest('.fixed')?.className).toBe('fixed right-4 top-4 z-50')
    expect(themeButton.closest('form')).toBeNull()
    expect(themeButton.classList.contains('h-11') && themeButton.classList.contains('w-11')).toBe(true)
    expect(themeButton.classList.contains('bg-brand-surface')).toBe(true)
    themeButton.click(); await flush(); expect(host.querySelector('[role="menu"]')).toBeTruthy()
    app.unmount(); host.remove(); apps.pop()
  }
})
it.each([3,4])('recarga paso %i mediante testigo y borrador seguro; llega a elegir plan', async step => {
  sessionStorage.setItem('flow-registration-draft',JSON.stringify({ email:'ana@local.test',step,organizationName:'Acme',slug:'acme',teamSize:'2-10',invitees:['team@local.test'] }))
  const { host,fetch,navigate } = await mount(true)
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(String(step))
  expect(host.querySelectorAll('button[aria-label^="Tema:"]')).toHaveLength(1)
  expect(host.querySelector('button[aria-label^="Tema:"]')?.closest('.fixed')?.className).toBe('fixed right-4 top-4 z-50')
  expect(host.querySelector('[aria-label="Plan elegido"]')?.textContent).toContain('Agenda')
  expect(sessionStorage.getItem('flow-registration-draft')).not.toMatch(/password|witness|token/i)
  if (step===3) {
    expect(host.querySelector<HTMLInputElement>('#organizationName')?.value).toBe('Acme')
    button(host,'Continuar').click(); await flush()
  } else expect(host.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('team@local.test')
  button(host,'Continuar').click(); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/auth/register',{ method:'POST',body:{ organizationName:'Acme',slug:'acme',invitees:[{ email:'team@local.test' }] } })
  expect(navigate).toHaveBeenCalledWith('/elegir-plan'); expect(sessionStorage.getItem('flow-registration-draft')).toBeNull()
  expect(host.querySelector('[aria-label="Plan elegido"]')?.textContent).toContain('Agenda')
  expect(host.querySelectorAll('button[aria-label^="Tema:"]')).toHaveLength(1)
})
it('borrador sin testigo no autoriza pasos 3/4; otro correo tampoco restaura un borrador ajeno', async () => {
  sessionStorage.setItem('flow-registration-draft',JSON.stringify({ email:'ana@local.test',step:4,organizationName:'Inyectada' }))
  const first=await mount(false)
  expect(first.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2')
  sessionStorage.setItem('flow-registration-draft',JSON.stringify({ email:'otra@local.test',step:4,organizationName:'Ajena' }))
  const second=await mount(true)
  expect(second.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3')
  expect(second.host.querySelector<HTMLInputElement>('#organizationName')?.value).toBe('')
})
it('muestra una tarjeta de plan antes del indicador en los cinco pasos', async () => {
  const { host } = await mount(false, false, false, true)
  expectPlanBeforeStep(host, 1)
  await input(host, '#fullName', 'Ana Pérez'); await input(host, '#email', 'ana@local.test')
  await input(host, '#password', 'Clave1234'); await input(host, '#confirmPassword', 'Clave1234')
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await flush()
  button(host, 'Continuar').click(); await flush(); expectPlanBeforeStep(host, 2)
  await input(host, '#verification-code', '123456'); button(host, 'Verificar correo').click(); await flush(); expectPlanBeforeStep(host, 3)
  await input(host, '#organizationName', 'Acme'); await new Promise(resolve => setTimeout(resolve, 450)); await flush()
  button(host, 'Continuar').click(); await flush(); expectPlanBeforeStep(host, 4)
  button(host, 'Continuar').click(); await flush(); expectPlanBeforeStep(host, 5)
})
it('Atrás en OTP corrige correo; el siguiente código usa el endpoint provisional y mantiene el plan', async () => {
  const { host,fetch }=await mount()
  button(host,'Atrás').click(); await flush()
  await input(host,'#new-email','otra@local.test'); button(host,'Guardar y enviar').click(); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/auth/register/change-email',{ method:'POST',body:{ email:'otra@local.test' } })
  expect(host.textContent).toContain('otra@local.test'); expect(host.querySelector('[aria-label="Plan elegido"]')?.textContent).toContain('Agenda')
  await input(host,'#verification-code','12 3456'); expect(host.querySelector<HTMLInputElement>('#verification-code')?.value).toBe('123456')
  button(host,'Verificar correo').click(); await flush()
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3')
  expect(fetch).toHaveBeenCalledWith('/api/auth/register/verify',{ method:'POST',body:{ code:'123456' } })
})
it('OTP rechazado no muestra organización; error anunciado y reintento disponibles', async () => {
  const { host }=await mount(false,true)
  await input(host,'#verification-code','123456'); button(host,'Verificar correo').click(); await flush()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('no es válido')
  expect(host.querySelector('#organizationName')).toBeNull(); expect(button(host,'Verificar correo').disabled).toBe(false)
})
