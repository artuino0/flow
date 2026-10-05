// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { bootPublicAgenda } from '../../utils/publicAgendaRuntime'
const config = { site: 'site190', page: 'page190', locale: 'es', accent: 'rgb(0 110 132)', timezone: 'UTC', assignmentMode: 'auto' }
async function settle() { for (let n=0;n<30;n++) await Promise.resolve() }
afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); history.replaceState(null, '', '/') })
it('fragmento de confirmación se retira antes de enviar, pide acción explícita y doble clic no duplica', async () => {
  history.replaceState(null, '', '/agenda-manage/site190/page190?private=1#confirm=' + 'A'.repeat(43))
  document.body.innerHTML = '<main data-flow-agenda-management></main>'
  const fetch = vi.fn(async () => new Response(JSON.stringify({ date: '2026-10-05', time: '09:00', timezone: 'UTC', services: ['Consulta'], personal: 'Ana', token: 'B'.repeat(43) }))); vi.stubGlobal('fetch', fetch)
  bootPublicAgenda({ ...config, management: true }); await settle()
  expect(location.hash).toBe(''); expect(location.search).toBe(''); expect(fetch).not.toHaveBeenCalled()
  const root = document.querySelector('main')!.shadowRoot!, button = root.querySelector('button')!
  button.click(); button.click(); await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/api/public/agenda/confirm'); expect(JSON.parse(String(request.body))).toMatchObject({ token: 'A'.repeat(43) }); expect(request.referrerPolicy).toBe('no-referrer'); expect(root.textContent).toContain('Tu cita')
})
it.each([410, 404])('enlace %s muestra mensaje claro sin afirmar confirmación', async code => {
  history.replaceState(null, '', '/agenda-manage/site190/page190#confirm=' + 'A'.repeat(43)); document.body.innerHTML = '<main data-flow-agenda-management></main>'
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: code })))
  bootPublicAgenda({ ...config, management: true }); const root = document.querySelector('main')!.shadowRoot!
  root.querySelector('button')!.click(); await settle()
  expect(root.textContent).toContain(code === 410 ? 'El horario ya fue liberado' : 'Este enlace ya no está disponible')
})
it('desafío se monta en Light DOM con slot, siempre claro; la reserva pendiente muestra su estado real', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
  document.body.innerHTML = '<div data-flow-agenda="inline"></div>'
  const requests: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return new Response(JSON.stringify(url.includes('slots?') ? { services: [{ id: 's', name: 'Consulta' }], people: [], mode: 'auto', requiredFields: ['name','email'], requireConsent: false, formToken: 'form', slots: [], automatic: [{ date: '2026-10-04', time: '15:00', timezone: 'UTC', personal: 'any' }] } : { date: '2026-10-04', time: '15:00', timezone: 'UTC', services: ['Consulta'], personal: 'Ana', pending: true, token: '' }))
  }))
  const render = vi.fn((element: HTMLElement, options: { callback: (token: string) => void; theme: string; action: string }) => {
    expect(element.getRootNode()).toBe(document); expect(element.slot).toBe('flow-challenge'); expect(options.theme).toBe('light'); expect(options.action).toBe('book')
    queueMicrotask(() => options.callback('simulated-token')); return 'widget'
  })
  Object.assign(window, { turnstile: { render, remove: vi.fn() } })
  const cleanup = bootPublicAgenda({ ...config, turnstileSiteKey: 'test-key' }); await settle()
  const host = document.querySelector<HTMLElement>('[data-flow-agenda]')!, root = host.shadowRoot!
  root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); root.querySelector<HTMLButtonElement>('.slots button')!.click(); root.querySelector<HTMLButtonElement>('.footer .primary')!.click()
  for (const [name, value] of [['name','Ana'],['email','ana@example.test']]) { const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!; input.value = value!; input.dispatchEvent(new Event('input')) }
  vi.setSystemTime(new Date('2026-10-04T12:00:03Z')); root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle()
  expect(render).toHaveBeenCalledTimes(1); expect(JSON.parse(String(requests.find(request => request.url.endsWith('/book'))!.init.body)).turnstileToken).toBe('simulated-token')
  expect(root.textContent).toContain('Tu cita está por confirmar'); expect(root.textContent).not.toContain('¡Listo, tu cita está confirmada!'); expect(host.querySelector('[slot]')).toBeNull()
  cleanup(); delete (window as Window & { turnstile?: unknown }).turnstile
})
it('sin variables o demostración no carga script externo', async () => {
  document.body.innerHTML = '<div data-flow-agenda="inline"></div>'
  const cleanup = bootPublicAgenda({ ...config, turnstileSiteKey: 'test', preview: true }); await settle()
  expect(document.querySelector('script[data-flow-turnstile]')).toBeNull(); cleanup()
})
it('el foco del modal entra al iframe del desafío con los botones de envío deshabilitados', async () => {
  document.body.innerHTML = '<button data-flow-agenda-open>Abrir</button>'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('slots?') ? { services: [{ id: 's', name: 'Consulta' }], people: [], mode: 'auto', requiredFields: ['name','email'], requireConsent: false, formToken: 'f', slots: [], automatic: [] } : {}))))
  const cleanup = bootPublicAgenda({ ...config, turnstileSiteKey: 'test' }); document.querySelector<HTMLButtonElement>('button')!.click(); await settle()
  const host = document.querySelector<HTMLElement>('body > div')!, root = host.shadowRoot!
  // Mismo contenedor Light DOM/slot del desafío; iframe de proveedor simulado.
  const slot = document.createElement('slot'); slot.name = 'flow-challenge'; root.querySelector('section')!.append(slot)
  const container = document.createElement('div'); container.slot = 'flow-challenge'; const frame = document.createElement('iframe'); frame.title = 'Comprobación contra bots'; container.append(frame); host.append(container)
  root.querySelectorAll<HTMLButtonElement>('button:not(.close)').forEach(button => { button.disabled = true })
  const close = root.querySelector<HTMLButtonElement>('.close')!; close.focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); close.dispatchEvent(event)
  expect(document.activeElement).toBe(frame)
  cleanup()
})
