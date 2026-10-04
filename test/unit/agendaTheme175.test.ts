// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, Suspense, ref, reactive, computed, watch, onBeforeUnmount, onMounted, useId, type App, type Component } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as agenda from '../../utils/agenda'
import { themeBootstrap, THEME_STORAGE_KEY } from '../../utils/theme'
import { auditThemeColors, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { readFileSync } from 'node:fs'
const apps: App[] = []
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks() })
const person = { id: '00000000-0000-4000-8000-000000000001', name: 'Ana' }
type Surface = 'AgendaScheduleEditor' | 'AgendaTimeOffEditor' | 'SettingsAgenda' | 'AgendaConflictOverride'
async function mount(surface: Surface, mode: string, state: { installed?: boolean; readonly?: boolean; error?: boolean } = {}) {
  localStorage.setItem(THEME_STORAGE_KEY, mode)
  new Function('localStorage', 'window', 'document', themeBootstrap)(localStorage, { matchMedia: () => ({ matches: true }) }, document)
  const api = vi.fn(async (url: string, _options?: unknown) => url === '/api/agenda/availability' ? { slots: [], automatic: [] } : {})
  const refresh = vi.fn(), dirty = vi.fn()
  const permissions = { edit: !state.readonly, manage: !state.readonly }
  const globals = { ref, reactive, computed, watch, onBeforeUnmount, onMounted, useId, nextTick,
    useAuth: () => ({ user: ref({ id: person.id }) }), useRequestHeaders: () => ({}), useIsAdmin: async () => ({ data: ref(true) }), $fetch: api,
    useFetch: (url: string) => ({ pending: ref(false), error: ref(state.error ? new Error('Prueba') : null), refresh,
      data: ref(url.endsWith('/settings') ? { installed: state.installed !== false, settings: agenda.agendaDefaults, timezone: 'America/Mexico_City', people: [person], permissions }
        : url.endsWith('/schedules') ? { schedules: [{ weekday: 1, startTime: '09:00', endTime: '18:00', validFrom: null, validTo: null }], permissions } : { blocks: [], permissions }) }) }
  const comp = compileVueComponent(`components/${surface}.vue`, { '~/utils/agenda': agenda }, globals)
  const props = surface === 'AgendaScheduleEditor' ? { userId: person.id } : surface === 'AgendaTimeOffEditor' ? { people: [person], ownId: person.id, manage: !state.readonly, edit: !state.readonly } : surface === 'AgendaConflictOverride' ? { modelValue: '' } : {}
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(comp, { ...props, onDirty: dirty }) }) })
  const link: Component = { setup(_, { attrs, slots }) { return () => h('a', { href: String(attrs.to) }, slots.default?.()) } }
  app.component('NuxtLink', link)
  app.component('AgendaCard', compileVueComponent('components/AgendaCard.vue'))
  app.component('AgendaInternalModal', compileVueComponent('components/AgendaInternalModal.vue', {}, globals))
  app.component('AgendaScheduleSummary', compileVueComponent('components/AgendaScheduleSummary.vue', { '~/utils/agenda': agenda }, globals))
  for (const child of ['AgendaScheduleEditor', 'AgendaTimeOffEditor']) app.component(child, { template: '<div />' })
  const host = document.createElement('div'); document.body.append(host); apps.push(app); app.mount(host); await flush()
  return { host, api, refresh, dirty }
}
const click = async (host: Element, text: string) => { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === text)!; expect(button).toBeTruthy(); button.click(); await flush() }
describe.each(['light', 'dark', 'system'])('Agenda en %s sin red', mode => {
  it.each(['AgendaScheduleEditor', 'AgendaTimeOffEditor', 'SettingsAgenda', 'AgendaConflictOverride'] as Surface[])('monta %s con tokens y tema heredado', async surface => {
    const { host } = await mount(surface, mode)
    expect(host.querySelector('[data-dark-ready="true"]')).toBeTruthy()
    expect(host.querySelector('.theme-light')).toBeNull()
    expect(document.documentElement.dataset.theme).toBe(mode === 'light' ? 'light' : 'dark')
    expect(host.textContent?.trim().length).toBeGreaterThan(30)
    if (surface === 'AgendaTimeOffEditor') { expect(host.querySelector('[role="dialog"]')).toBeNull(); await click(host, '＋ Nuevo bloqueo'); expect(host.querySelector('[role="dialog"]')).toBeTruthy() }
    expect(host.querySelectorAll('label').length).toBeGreaterThan(0)
  })
  it('horario permite agregar, copiar, guardar y detectar traslapes', async () => {
    const { host, api, dirty } = await mount('AgendaScheduleEditor', mode)
    await click(host, 'Guardar horario')
    expect(api).toHaveBeenCalledWith('/api/agenda/schedules', expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ userId: person.id }) }))
    const copy = host.querySelector<HTMLSelectElement>('select')!; copy.value = '2'; copy.dispatchEvent(new Event('change', { bubbles: true })); await flush()
    expect(dirty).toHaveBeenCalledWith(true)
    await click(host, 'Guardar horario'); expect(api.mock.calls.at(-1)?.[1]).toMatchObject({ body: { schedules: expect.arrayContaining([expect.objectContaining({ weekday: 2 })]) } })
    const add = host.querySelector<HTMLButtonElement>('[aria-label="Agregar rango a Lunes"]')!; add.click(); await flush(); await click(host, 'Guardar horario')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('traslaparse')
  })
  it('bloqueos vacíos y alta mandan hora local y motivo', async () => {
    const { host, api } = await mount('AgendaTimeOffEditor', mode)
    expect(host.textContent).toContain('Sin bloqueos')
    await click(host, '＋ Nuevo bloqueo')
    for (const [selector, value] of [['#agenda-block-reason', 'Vacaciones'], ['input[type="datetime-local"]', '2026-10-05T00:00']] as const) { const el = host.querySelector<HTMLInputElement>(selector)!; el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }
    const end = host.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1]!; end.value = '2026-10-06T00:00'; end.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(api).toHaveBeenCalledWith('/api/agenda/time-off', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ userId: person.id, reason: 'Vacaciones', startLocal: '2026-10-05T00:00' }) }))
  })
  it('ajustes guardan y muestran vista previa vacía', async () => {
    const { host, api } = await mount('SettingsAgenda', mode)
    await click(host, 'Guardar ajustes'); expect(api).toHaveBeenCalledWith('/api/agenda/settings', expect.objectContaining({ method: 'PUT' }))
    await click(host, 'Ver huecos'); expect(host.textContent).toContain('No hay huecos libres')
    expect(api).toHaveBeenCalledWith('/api/agenda/availability', expect.objectContaining({ query: expect.objectContaining({ personal: person.id, duration: 30 }) }))
  })
  it('sin Citas base guía a instalación y lectura bloquea edición', async () => {
    const missing = await mount('SettingsAgenda', mode, { installed: false })
    expect(missing.host.querySelector('a')?.getAttribute('href')).toBe('/modulos/nuevo')
    expect(missing.host.querySelector('form')).toBeNull()
    const readonly = await mount('AgendaScheduleEditor', mode, { readonly: true })
    expect(readonly.host.querySelector('fieldset')?.disabled).toBe(true)
    expect(readonly.host.textContent).toContain('solo lectura')
  })
  it('error presenta reintento y aviso accesible', async () => {
    const { host, refresh } = await mount('AgendaScheduleEditor', mode, { error: true })
    expect(host.querySelector('[role="alert"]')).toBeTruthy(); await click(host, 'Reintentar'); expect(refresh).toHaveBeenCalledOnce()
  })
})
it('guardia incluye cada superficie nueva y páginas mantienen darkReady', () => {
  expect(auditThemeColors()).toEqual([])
  for (const surface of ['AgendaScheduleEditor', 'AgendaTimeOffEditor', 'SettingsAgenda', 'AgendaConflictOverride']) expect(migratedThemeFiles).toContain(`components/${surface}.vue`)
  for (const file of ['pages/usuarios/[id].vue', 'pages/ajustes/index.vue', 'pages/registros/[entity]/nuevo.vue', 'pages/registros/[entity]/[id]/editar.vue']) expect(readFileSync(file, 'utf8')).toContain('darkReady: true')
  expect(readFileSync('components/SettingsProfile.vue', 'utf8')).toContain('/ajustes?section=mi-horario')
})
