// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { useAgendaOffer } from '../../composables/useAgendaOffer'
import { themeBootstrap, THEME_STORAGE_KEY } from '../../utils/theme'
import { auditThemeSource, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { darkTokens, lightTokens } from '../../utils/themeTokens'

const apps: App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function mount(mode: 'light' | 'dark' | 'system' = 'light', base = false, changeClient = false) {
  localStorage.setItem(THEME_STORAGE_KEY, mode)
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
  new Function('localStorage', 'window', 'document', themeBootstrap)(localStorage, window, document)
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/agenda/options') return { base: base ? { id: 'citas', slug: 'agenda-citas', name: 'Citas' } : null, clientSlug: 'propios', modules: [{ id: 'cliente', slug: 'propios', name: 'Clientes propios' }] }
    if (url === '/api/agenda/install') return {}
    if (url === '/api/agenda/client') return { affectedRecords: 2 }
    throw new Error('Petición inesperada')
  })
  const toast = { updated: vi.fn() }
  const component = compileVueComponent('components/AgendaBaseModal.vue', {}, { $fetch: fetch, useToast: () => toast })
  const props = ref({ open: false, changeClient })
  const installed = vi.fn(), declined = vi.fn(), changed = vi.fn(), closed = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(component, { ...props.value, onInstalled: installed, onDecline: declined, onChanged: changed, onClose: closed }) })
  apps.push(app); app.mount(host); props.value.open = true; await flush()
  return { props, fetch, installed, declined, changed, closed, toast }
}
const button = (text: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)
  expect(found, text).toBeTruthy(); return found!
}

it.each(['light', 'dark', 'system'] as const)('modal y avisos respetan %s sin instalar por detección', async mode => {
  const { fetch, declined } = await mount(mode)
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog).toBeTruthy(); expect(document.activeElement).toBe(dialog)
  expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
  expect(dialog.classList.contains('bg-brand-surface')).toBe(true)
  expect(dialog.querySelector('.theme-light')).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
  button('Crear el mío').click(); await flush()
  expect(declined).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(1)
  for (const tokens of [lightTokens, darkTokens]) for (const key of ['surface', 'text', 'info-bg', 'info-text', 'warning-bg', 'warning-text', 'overlay'] as const) expect(tokens[key]).toBeTruthy()
})

it('elige Clientes de plantilla y solo instala tras confirmar', async () => {
  const { fetch, installed } = await mount()
  button('Usar prearmado').click(); await flush()
  expect(fetch).toHaveBeenCalledTimes(1)
  button('Instalar Citas').click(); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/agenda/install', { method: 'POST', body: { mode: 'create' } })
  expect(installed).toHaveBeenCalledWith('agenda-citas')
})

it('vincula el módulo seleccionado y no duplica un base existente', async () => {
  const first = await mount()
  button('Usar prearmado').click(); await flush()
  const radio = document.querySelector<HTMLInputElement>('input[value="link"]')!
  radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await flush()
  const select = document.querySelector<HTMLSelectElement>('select')!
  select.value = 'cliente'; select.dispatchEvent(new Event('change', { bubbles: true })); await flush()
  button('Instalar Citas').click(); await flush()
  expect(first.fetch).toHaveBeenCalledWith('/api/agenda/install', { method: 'POST', body: { mode: 'link', entityId: 'cliente' } })
  apps.splice(0).forEach(app => app.unmount())
  const second = await mount('dark', true)
  button('Abrir Citas').click(); await flush()
  expect(second.installed).toHaveBeenCalledWith('agenda-citas'); expect(second.fetch).toHaveBeenCalledTimes(1)
})

it.each(['light', 'dark', 'system'] as const)('confirma y avisa antes de cambiar Cliente en %s', async mode => {
  const { fetch, changed, toast } = await mount(mode, true, true)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('campo histórico visible')
  expect(button('Cambiar vínculo').disabled).toBe(true)
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await flush()
  button('Cambiar vínculo').click(); await flush()
  expect(fetch).toHaveBeenCalledWith('/api/agenda/client', { method: 'PUT', body: { entityId: 'cliente', confirmed: true } })
  expect(changed).toHaveBeenCalledOnce(); expect(toast.updated.mock.calls[0]?.[1]).toContain('2 citas')
})

it('atrapa foco, Escape cancela sin instalar y presenta errores del servidor', async () => {
  const { fetch, closed } = await mount()
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Cerrar')
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(closed).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(1)
  button('Usar prearmado').click(); await flush()
  fetch.mockRejectedValueOnce({ data: { statusMessage: 'El módulo no tiene texto' } })
  button('Instalar Citas').click(); await flush()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('El módulo no tiene texto')
})

it('la elección propia solo se recuerda en memoria y manual/diseñador esperan el mismo modal', async () => {
  let offer!: ReturnType<typeof useAgendaOffer>
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ setup() { offer = useAgendaOffer(); return () => h('div') } }); apps.push(app); app.mount(host)
  expect(await offer.ask('Ventas')).toBe(true)
  const pending = offer.ask('Citas bibliográficas')
  expect(offer.open.value).toBe(true)
  offer.finish(true); expect(await pending).toBe(true)
  expect(await offer.ask('Agenda')).toBe(true); expect(offer.open.value).toBe(false)
  expect(localStorage.length).toBe(0)
  for (const file of ['components/ModuleWizard.vue', 'pages/disenador.vue']) {
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('<AgendaBaseModal')
    expect(source).toContain('await agendaOffer.ask(')
    expect(source).toContain('@decline="agendaOffer.finish(true)"')
  }
})

it('incluye el modal en la guardia de colores y protege las superficies nuevas', () => {
  expect(migratedThemeFiles).toContain('components/AgendaBaseModal.vue')
  for (const file of ['components/AgendaBaseModal.vue', 'components/FieldFormModal.vue', 'components/ModuleFieldsCard.vue', 'components/ModuleWizard.vue', 'pages/modulos/[id]/editar.vue', 'pages/disenador.vue']) expect(auditThemeSource(file, readFileSync(file, 'utf8'))).toEqual([])
})
