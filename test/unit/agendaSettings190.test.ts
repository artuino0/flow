// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, Suspense, watch, type App } from 'vue'
import * as publicTypes from '../../utils/agendaPublic'
import * as accent from '../../utils/agendaAccent'
import * as runtime from '../../utils/publicAgendaRuntime'
import * as administration from '../../utils/agendaAdministration'
import { compileVueComponent } from '../helpers/vueComponent'
import { registerAgendaAdministrationComponents } from '../helpers/agendaAdministrationView'
let app: App | undefined
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks() })
it.each(['light', 'dark'] as const)('%s: controles claros, correo obligatorio, plazo y guardado real del formulario', async theme => {
  document.documentElement.dataset.theme = theme
  const data = ref({ settings: publicTypes.agendaSiteSettingsSchema.parse({}), available: true, services: [{ id: 's', name: 'Consulta' }], people: [{ id: 'p', name: 'Ana', scheduled: true }], recent: [], botProtectionCanDisable: false })
  const fetch = vi.fn(async () => data.value), meta = vi.fn()
  const component = compileVueComponent('pages/sites/[siteId]/agenda/index.vue', { '~/utils/agendaPublic': publicTypes, '~/utils/agendaAccent': accent, '~/utils/publicAgendaRuntime': runtime, '~/utils/agendaAdministration': administration }, { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch, definePageMeta: meta, useRoute: () => ({ params: { siteId: 's' } }), useRequestHeaders: () => ({}), useFetch: async (url: string) => ({ data: url.startsWith('/api/sites/') ? ref({ pages: [] }) : data, pending: ref(false), error: ref(null), refresh: vi.fn() }), $fetch: fetch })
  app = createApp({ render: () => h(Suspense, {}, { default: () => h(component) }) }); registerAgendaAdministrationComponents(app)
  const host = document.createElement('div'); document.body.append(host); app.mount(host); for(let n=0;n<30;n++) await Promise.resolve(); await nextTick()
  expect(meta).toHaveBeenCalledWith({ layout: 'default', darkReady: true })
  expect(host.querySelector('#agenda-bots option[value=disabled]')).toBeNull(); expect(host.querySelector('label[for=agenda-bots]')).not.toBeNull()
  const confirm = host.querySelector<HTMLInputElement>('[aria-describedby=agenda-confirm-help]')!; confirm.click(); await nextTick()
  expect(host.querySelector<HTMLInputElement>('#agenda-confirm-minutes')!.value).toBe('15')
  host.querySelector<HTMLSelectElement>('#agenda-outage')!.value = 'deny'; host.querySelector('#agenda-outage')!.dispatchEvent(new Event('change')); await nextTick()
  host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); for(let n=0;n<30;n++) await Promise.resolve(); await nextTick()
  expect(fetch).toHaveBeenCalledWith('/api/agenda/site-settings', { method: 'PUT', body: { site: 's', settings: { ...data.value.settings, confirmEmail: true, turnstileOutage: 'deny' } } })
  data.value = { ...data.value, settings: publicTypes.agendaSiteSettingsSchema.parse({ requiredFields: ['phone'], visibleFields: ['phone'] }) }; await nextTick()
  expect(confirm.disabled).toBe(true); expect(host.querySelector('#agenda-confirm-help')!.textContent).toContain('Correo obligatorio')
})
