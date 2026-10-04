// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, Suspense, watch, type App } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import * as publicTypes from '../../utils/agendaPublic'
import * as accent from '../../utils/agendaAccent'
import * as publicRuntime from '../../utils/publicAgendaRuntime'
import * as administration from '../../utils/agendaAdministration'
import { registerAgendaAdministrationComponents } from '../helpers/agendaAdministrationView'
import { lightTokens, darkTokens } from '../../utils/themeTokens'
import { auditThemeSource, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { chattitoHelpId } from '../../utils/chattitoHelp'
import { resolveChattitoContext } from '../../utils/chattitoContext'
import { contextualTourMatchesRoute, onboardingTours } from '../../utils/onboardingTours'
const file = 'pages/sites/[siteId]/agenda/index.vue'
const apps: App[] = []
const fixtures = () => ({ settings: publicTypes.agendaSiteSettingsSchema.parse({}), available: true, reason: null as string | null, services: [{ id: 's', name: 'Consulta' }], people: [{ id: 'p', name: 'Ana', scheduled: true }, { id: 'p2', name: 'Pedro', scheduled: false }], recent: [] })
async function mount(theme: 'light' | 'dark', options: { unavailable?: boolean; error?: boolean; saveError?: boolean } = {}) {
  document.documentElement.dataset.theme = theme
  const response = fixtures(); if (options.unavailable) { response.available = false; response.reason = 'Instala Citas base.'; response.services = []; response.people = [] }
  const data = ref(response), refresh = vi.fn(), meta = vi.fn(), fetch = vi.fn(async () => { if (options.saveError) throw new Error('offline'); return response })
  const component = compileVueComponent(file, { '~/utils/agendaAccent': accent, '~/utils/agendaPublic': publicTypes, '~/utils/publicAgendaRuntime': publicRuntime, '~/utils/agendaAdministration': administration }, { reactive, ref, toRaw, computed, watch, onMounted, onBeforeUnmount, useRoute: () => ({ params: { siteId: 'site' } }), useFetch: async (url: string) => url.startsWith('/api/sites/') ? { data: ref({ pages: [] }), refresh: vi.fn(), error: ref(null), pending: ref(false) } : ({ data, refresh, error: ref(options.error ? new Error('failed') : null), pending: ref(false) }), useRequestHeaders: () => ({}), definePageMeta: meta, $fetch: fetch })
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component) }) }); registerAgendaAdministrationComponents(app)
  const host = document.createElement('div'); document.body.append(host); app.mount(host); apps.push(app)
  for (let i = 0; i < 10; i++) await Promise.resolve(); await nextTick()
  return { host, fetch, refresh, meta, data }
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })
describe('Administración de agenda, Claro/Oscuro/Sistema', () => {
  it.each([{ choice: 'Claro', resolved: 'light' }, { choice: 'Oscuro', resolved: 'dark' }, { choice: 'Sistema claro', resolved: 'light' }, { choice: 'Sistema oscuro', resolved: 'dark' }] as const)('$choice: formulario real y vista pública clara aislada', async ({ resolved }) => {
    const { host, meta, fetch } = await mount(resolved); expect(meta).toHaveBeenCalledWith({ layout: 'default', darkReady: true }); expect(host.textContent).toContain('Agenda del sitio'); expect(host.querySelectorAll('input[type=search]')).toHaveLength(2)
    const publicDoc = host.querySelector('iframe')!.getAttribute('srcdoc')!; expect(publicDoc).toContain('color-scheme'); expect(publicDoc).toContain('content="light"'); expect(publicDoc).toContain('preview":true'); expect(publicDoc).not.toContain('--brand-'); expect(fetch).not.toHaveBeenCalled()
    const checkbox = Array.from(host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).find(input => input.disabled); expect(checkbox).toBeDefined(); expect(host.textContent).toContain('Sin horario')
    const source = readFileSync(file, 'utf8'); expect(auditThemeSource(file, source)).toEqual([]); expect(source).toContain('rgb(var(--brand-surface))'); expect(source).toContain('rgb(var(--brand-text))'); expect(resolved === 'dark' ? darkTokens.surface : lightTokens.surface).toBeTruthy()
  })
  it('guarda settings estrictos y muestra confirmación', async () => { const { host, fetch, refresh } = await mount('dark'); host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); for (let i = 0; i < 10; i++) await Promise.resolve(); await nextTick(); expect(fetch).toHaveBeenCalledWith('/api/agenda/site-settings', { method: 'PUT', body: { site: 'site', settings: fixtures().settings } }); expect(refresh).toHaveBeenCalled(); expect(host.textContent).toContain('Cambios guardados') })
  it('validación impide guardar números fuera de rango y comunica el motivo', async () => { const { host, fetch } = await mount('light'); const input = host.querySelector<HTMLInputElement>('input[type=number]')!; input.value = '-1'; input.dispatchEvent(new Event('input')); await nextTick(); host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(fetch).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')).not.toBeNull() })
  it('campos ocultos no pueden ser obligatorios y siempre se pide un contacto', () => {
    expect(publicTypes.agendaSiteSettingsSchema.safeParse({ visibleFields: ['email'], requiredFields: ['name'] }).success).toBe(false)
    expect(publicTypes.agendaSiteSettingsSchema.safeParse({ visibleFields: ['name'], requiredFields: ['name'] }).success).toBe(false)
    expect(publicTypes.agendaSiteSettingsSchema.parse({ visibleFields: ['email'], requiredFields: ['email'] }).visibleFields).toEqual(['email'])
  })
  it.each(['light', 'dark'] as const)('estado vacío y error accionables en %s', async theme => { let result = await mount(theme, { unavailable: true }); expect(result.host.textContent).toContain('Instala Citas base'); expect(result.host.querySelector('input[type=checkbox]')?.hasAttribute('disabled')).toBe(true); expect(result.host.querySelector('a[to="/usuarios"]')).not.toBeNull(); result = await mount(theme, { error: true }); expect(result.host.textContent).toContain('Reintentar') })
  it('fallo de guardado conserva los datos', async () => { const { host } = await mount('dark', { saveError: true }); host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); for (let i = 0; i < 8; i++) await Promise.resolve(); await nextTick(); expect(host.textContent).toContain('Sin conexión. Reintenta'); expect(host.querySelector('form')).not.toBeNull() })
  it('registra guardia y recorrido contextual en la ruta Agenda', () => { expect(migratedThemeFiles).toContain(file); const context = resolveChattitoContext({ path: '/sites/s/agenda', params: {}, query: {} }); expect(chattitoHelpId(context)).toBe('sites:agenda'); expect(contextualTourMatchesRoute('sites-agenda', '/sites/s/agenda', {})).toBe(true); expect(onboardingTours['sites-agenda'].steps).toHaveLength(3) })
})
