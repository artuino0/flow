// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, Suspense, useId, watch, type App } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import * as agenda from '../../utils/agenda'
import { auditThemeColors, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { darkTokens, lightTokens } from '../../utils/themeTokens'

const apps: App[] = []
const own = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002'
const schedule = (weekday = 1, validFrom: string | null = null): agenda.AgendaSchedule => ({ weekday, startTime: '09:00', endTime: '18:00', validFrom, validTo: null })
const block = (userId: string | null = own, id = 'block') => ({ id, userId, startLocal: '2026-10-05T09:00', endLocal: '2026-10-05T12:00', reason: 'Ausencia', allDay: false })
const detail = { id: own, fullName: 'Ana López', email: 'ana@example.test', phone: null, roleName: 'Operadora', timezone: 'America/Mexico_City', createdAt: '2026-09-01T12:00:00Z' }
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); await nextTick() }
type Surface = 'AgendaScheduleEditor' | 'AgendaTimeOffEditor' | 'SettingsAgenda' | 'AgendaConflictOverride' | 'AgendaUserSchedule'
async function mount(surface: Surface, options: { readonly?: boolean; manage?: boolean; pending?: boolean; error?: boolean; ownOnly?: boolean; admin?: boolean; schedules?: agenda.AgendaSchedule[]; blocks?: ReturnType<typeof block>[]; saveError?: boolean; slots?: agenda.AgendaSlot[] } = {}) {
  const permissions = { edit: !options.readonly, manage: options.manage ?? !options.readonly }
  const response = ref({ schedules: options.schedules ?? [schedule()], permissions })
  const blocks = ref({ blocks: options.blocks ?? [], permissions })
  const settings = ref({ installed: true, settings: { ...agenda.agendaDefaults }, timezone: 'America/Mexico_City', people: [{ id: own, name: 'Ana' }, { id: other, name: 'Pedro' }], permissions })
  const api = vi.fn(async (url: string, request?: { body?: { schedules?: agenda.AgendaSchedule[] } }) => {
    if (options.saveError) throw { data: { statusMessage: 'No fue posible guardar.' } }
    if (url.endsWith('/availability')) return { slots: options.slots ?? [], automatic: [] }
    if (url.endsWith('/schedules') && request?.body?.schedules) response.value = { schedules: request.body.schedules, permissions }
    return {}
  })
  const refresh = vi.fn(), changed = vi.fn(), dirty = vi.fn(), model = ref('')
  const globals = { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount, useId, useAuth: () => ({ user: ref({ id: own }) }), useRequestHeaders: () => ({}), useIsAdmin: async () => ({ data: ref(options.admin !== false) }), $fetch: api,
    useFetch: (url: string) => ({ data: url.endsWith('/schedules') ? response : url.endsWith('/time-off') ? blocks : settings, pending: ref(!!options.pending), error: ref(options.error ? new Error('Falló') : null), refresh }) }
  const imports = { '~/utils/agenda': agenda }
  const component = compileVueComponent(`components/${surface}.vue`, imports, globals)
  const props = surface === 'AgendaScheduleEditor' ? { userId: own } : surface === 'AgendaTimeOffEditor' ? { people: settings.value.people, ownId: own, manage: permissions.manage, edit: permissions.edit, userId: options.ownOnly ? own : undefined } : surface === 'SettingsAgenda' ? { ownOnly: options.ownOnly } : surface === 'AgendaUserSchedule' ? { user: detail } : {}
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, { ...props, modelValue: model.value, 'onUpdate:modelValue': (value: string) => { model.value = value }, onChange: changed, onDirty: dirty }) }) })
  for (const child of ['AgendaCard', 'AgendaScheduleSummary', 'AgendaInternalModal', 'AgendaScheduleEditor', 'AgendaTimeOffEditor', 'ListPageHeader']) app.component(child, compileVueComponent(`components/${child}.vue`, imports, globals))
  app.component('NuxtLink', defineComponent({ setup: (_, { attrs, slots }) => () => h('a', { href: String(attrs.to) }, slots.default?.()) }))
  app.component('ChatAvatar', { template: '<span aria-hidden="true">AL</span>' })
  const host = document.createElement('div'); document.body.append(host); app.mount(host); apps.push(app); await flush()
  return { host, api, refresh, changed, dirty, response, blocks, model }
}
async function click(host: Element, text: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === text); expect(button, text).toBeTruthy(); button!.click(); await flush() }
async function input(element: HTMLInputElement, value: string) { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); await flush() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; document.body.style.overflow = ''; vi.restoreAllMocks() })

describe.each(['light', 'dark', 'system'])('Superficies de agenda 179 en %s', mode => {
  it.each(['AgendaUserSchedule', 'SettingsAgenda', 'AgendaTimeOffEditor', 'AgendaConflictOverride'] as Surface[])('%s hereda tokens, separa encabezado y cuerpo y no añade navegación horizontal', async surface => {
    document.documentElement.dataset.theme = mode === 'light' ? 'light' : 'dark'
    const { host } = await mount(surface)
    expect(host.querySelector('[data-dark-ready="true"]')).toBeTruthy()
    expect(host.querySelector('.agenda-card-heading')).toBeTruthy()
    expect(host.querySelector('.agenda-card-body')).toBeTruthy()
    expect(host.querySelector('.theme-light')).toBeNull()
    expect(host.querySelector('nav[aria-label="Secciones del sitio"]')).toBeNull()
    expect(host.textContent).not.toContain('Último acceso: hoy')
    const tokens = mode === 'light' ? lightTokens : darkTokens
    for (const name of ['surface', 'text', 'control-border', 'success-bg', 'success-text', 'warning-bg', 'warning-text'] as const) expect(tokens[name]).toBeTruthy()
  })
  it('ficha conserva identidad real, columna de resumen y siete días en orden lunes a domingo', async () => {
    const { host } = await mount('AgendaUserSchedule')
    expect(host.querySelector('h1')?.textContent).toBe('Ana López')
    expect(host.textContent).toContain('ana@example.test'); expect(host.textContent).toContain('Operadora')
    expect(host.textContent).toContain('No disponible')
    expect(host.querySelector('.agenda-summary-total')?.textContent).toContain('9 h')
    expect([...host.querySelectorAll('.agenda-day h3')].map(element => element.textContent)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])
  })
  it('Mi horario usa el mismo editor y resumen, respeta solo lectura y consulta siete días', async () => {
    const { host, api } = await mount('SettingsAgenda', { ownOnly: true, readonly: true })
    expect(host.textContent).toContain('Horario de solo lectura')
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    expect(host.querySelector('.agenda-personal-columns .agenda-summary-total')).toBeTruthy()
    expect(host.textContent).not.toContain('Reglas de agenda')
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Guardar horario')).toBe(false)
    await click(host, 'Ver huecos')
    expect(host.querySelectorAll('.agenda-week-day')).toHaveLength(7)
    expect(host.textContent).toContain('No hay huecos libres')
    const request = api.mock.calls.find(([url]) => url.endsWith('/availability'))?.[1]
    expect(request).toMatchObject({ query: { personal: own, duration: 30 } })
  })
})

describe('Horarios: presentación nueva, contratos existentes', () => {
  it('guardar sin editar conserva vigencias distintas por rango', async () => {
    const rows = [schedule(1, '2026-10-01'), schedule(2, '2026-11-01')]
    const { host, api } = await mount('AgendaScheduleEditor', { schedules: rows })
    expect(host.textContent).toContain('Vigencias distintas por rango')
    await click(host, 'Guardar horario')
    expect(api).toHaveBeenCalledWith('/api/agenda/schedules', { method: 'PUT', body: { userId: own, schedules: rows } })
  })
  it('vigencia general se aplica a todos los rangos; descartar restaura fechas y aviso dirty', async () => {
    const { host, changed, dirty } = await mount('AgendaScheduleEditor', { schedules: [schedule(1), schedule(2)] })
    await input(host.querySelector<HTMLInputElement>('input[type=date]')!, '2026-10-01')
    expect(changed.mock.calls.at(-1)?.[0]).toEqual([schedule(1, '2026-10-01'), schedule(2, '2026-10-01')])
    expect(dirty).toHaveBeenLastCalledWith(true)
    await click(host, 'Descartar'); expect(changed.mock.calls.at(-1)?.[0]).toEqual([schedule(1), schedule(2)])
    expect(dirty).toHaveBeenLastCalledWith(false)
  })
  it('desactivar un día retira sus rangos sin afectar otros días y actualiza el resumen', async () => {
    const { host, changed } = await mount('AgendaScheduleEditor', { schedules: [schedule(1), schedule(2)] })
    const toggle = host.querySelector<HTMLInputElement>('[aria-label="Trabaja el Lunes"]')!
    toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); await flush()
    expect(changed.mock.calls.at(-1)?.[0]).toEqual([schedule(2)])
    expect(host.querySelector('.agenda-day')?.textContent).toContain('No disponible')
  })
  it.each([{ pending: true, text: 'Cargando horario' }, { error: true, text: 'No se pudo cargar el horario' }])('estado $text conserva aviso accesible', async state => {
    const { host } = await mount('AgendaScheduleEditor', state)
    expect(host.querySelector(state.error ? '[role=alert]' : '[role=status]')?.textContent).toContain(state.text)
  })
})

describe('Bloqueos: tabla, permisos y modal accesible', () => {
  it('solo lectura no permite alta ni editar o eliminar; el filtro propio conserva bloqueos globales', async () => {
    const { host } = await mount('AgendaTimeOffEditor', { readonly: true, ownOnly: true, blocks: [block(), block(null, 'global'), block(other, 'other')] })
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(host.textContent).toContain('Toda la organización')
    expect(host.querySelector('button')).toBeNull()
  })
  it('un miembro solo edita sus bloqueos, un administrador puede editar toda la organización', async () => {
    const rows = [block(), block(null, 'global'), block(other, 'other')]
    const member = await mount('AgendaTimeOffEditor', { manage: false, blocks: rows })
    expect(member.host.querySelectorAll('tbody button')).toHaveLength(2)
    const admin = await mount('AgendaTimeOffEditor', { blocks: rows })
    expect(admin.host.querySelectorAll('tbody button')).toHaveLength(6)
  })
  it('modal concentra foco, cicla Tab, cierra con Escape y devuelve foco sin persistencia', async () => {
    const { host } = await mount('AgendaTimeOffEditor')
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Nuevo bloqueo'))!; trigger.focus(); trigger.click(); await flush()
    const modal = host.querySelector<HTMLElement>('[role=dialog]')!
    expect(modal.getAttribute('aria-modal')).toBe('true'); expect(document.getElementById(modal.getAttribute('aria-labelledby')!)?.textContent).toBe('Nuevo bloqueo')
    const buttons = [...modal.querySelectorAll<HTMLButtonElement>('button')]; const last = buttons.at(-1)!, first = buttons[0]!
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); expect(document.activeElement).toBe(first)
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); expect(document.activeElement).toBe(last)
    expect(document.body.style.overflow).toBe('hidden')
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush()
    expect(host.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe('')
  })
  it('editar conserva identificador y fin exclusivo de día completo; borrar usa la ruta existente', async () => {
    const { host, api } = await mount('AgendaTimeOffEditor', { blocks: [block()] })
    await click(host, 'Editar')
    const toggle = host.querySelector<HTMLInputElement>('[role=switch]')!; toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }))
    await input(host.querySelectorAll<HTMLInputElement>('input[type=datetime-local]')[1]!, '2026-10-06T12:00')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await flush()
    expect(api).toHaveBeenCalledWith('/api/agenda/time-off/block', expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ startLocal: '2026-10-05T00:00', endLocal: '2026-10-06T00:00', allDay: true }) }))
    expect(host.querySelector('[role=dialog]')).toBeNull()
    await click(host, 'Eliminar'); expect(api).toHaveBeenCalledWith('/api/agenda/time-off/block', { method: 'DELETE' })
  })
  it('un fallo deja abierto el modal y conserva motivo y fechas', async () => {
    const { host } = await mount('AgendaTimeOffEditor', { blocks: [block()], saveError: true })
    await click(host, 'Editar'); host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(host.querySelector('[role=dialog]')).toBeTruthy(); expect(host.querySelector('[role=alert]')?.textContent).toContain('No fue posible guardar')
    expect(host.querySelector<HTMLInputElement>('#agenda-block-reason')?.value).toBe('Ausencia')
  })
})

describe('Choque interno y vista previa semanal', () => {
  it('descartar el horario conserva el aviso de reglas pendientes y descartar ambas partes lo limpia', async () => {
    const { host, dirty } = await mount('SettingsAgenda')
    const rule = host.querySelector<HTMLInputElement>('input[type=number]')!
    await input(rule, '60')
    await input(host.querySelector<HTMLInputElement>('input[type=time]')!, '10:00')
    expect(dirty).toHaveBeenLastCalledWith(true)
    const scheduleForm = host.querySelector('input[type=time]')!.closest('form')!
    await click(scheduleForm, 'Descartar')
    expect(rule.value).toBe('60'); expect(dirty).toHaveBeenLastCalledWith(true)
    await click(host, 'Descartar'); expect(rule.value).toBe('30'); expect(dirty).toHaveBeenLastCalledWith(false)
  })
  it('solo el administrador ve el modal; el motivo se valida y cancelar lo limpia sin guardar la cita', async () => {
    const denied = await mount('AgendaConflictOverride', { admin: false }); expect(denied.host.querySelector('[role=dialog]')).toBeNull()
    const { host, model, api } = await mount('AgendaConflictOverride')
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Confirmar motivo')!
    expect(confirm.disabled).toBe(true)
    const reason = host.querySelector<HTMLTextAreaElement>('textarea')!; reason.value = 'Excepción autorizada'; reason.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    expect(confirm.disabled).toBe(false); expect(model.value).toBe('Excepción autorizada')
    await click(host, 'Cancelar'); expect(model.value).toBe(''); expect(api).not.toHaveBeenCalled()
  })
  it('agrupar huecos conserva fecha, persona y duración; descartar reglas restaura valores', async () => {
    const slot: agenda.AgendaSlot = { userId: own, date: '2026-10-05', time: '10:00', start: '2026-10-05T16:00:00Z', end: '2026-10-05T16:30:00Z', status: 'free' }
    const { host, api } = await mount('SettingsAgenda', { slots: [slot] })
    await input(host.querySelector<HTMLInputElement>('input[type=date][required]')!, '2026-10-05')
    await click(host, 'Ver huecos'); expect(host.querySelectorAll('.agenda-week-day')).toHaveLength(7)
    expect(host.querySelector('.agenda-week-day')?.textContent).toContain('10:00'); expect(host.querySelector('.agenda-week-day')?.textContent).toContain('Ana')
    expect(api).toHaveBeenCalledWith('/api/agenda/availability', { query: { personal: own, from: '2026-10-05', to: '2026-10-11', duration: 30 } })
    const number = host.querySelector<HTMLInputElement>('input[type=number]')!; await input(number, '60'); await click(host, 'Descartar'); expect(number.value).toBe('30')
  })
})

it('guardia cubre componentes compartidos, CSS adapta móvil y ningún modal usa almacenamiento', () => {
  expect(auditThemeColors()).toEqual([])
  for (const name of ['AgendaCard', 'AgendaInternalModal', 'AgendaScheduleSummary', 'AgendaUserSchedule', 'AgendaChoiceTiles']) expect(migratedThemeFiles).toContain(`components/${name}.vue`)
  const css = readFileSync('assets/css/agenda.css', 'utf8')
  expect(css).toContain('@media(max-width:720px)'); expect(css).toContain('grid-template-columns:minmax(0,1fr)')
  expect(readFileSync('components/AgendaUserSchedule.vue', 'utf8')).toContain('grid-template-columns:320px minmax(0,1fr)')
  expect(readFileSync('components/AgendaInternalModal.vue', 'utf8')).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
})
