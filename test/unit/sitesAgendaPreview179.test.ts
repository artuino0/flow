import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { buildAgendaEditorPreview, type AgendaEditorPreviewState } from '../../utils/sitesAgendaPreview'
import { buildPreviewDocument } from '../../utils/sitesEditorScript'
import { agendaSiteSettingsSchema } from '../../utils/agendaPublic'

const windows: JSDOM[] = []
const state = (): AgendaEditorPreviewState => ({ settings: agendaSiteSettingsSchema.parse({ enabled: true, accent: 'custom', accentColor: '#AbC' }), missing: [], assignmentMode: 'both', timezone: 'America/Mexico_City' })
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve() }
async function preview(html: string, config: AgendaEditorPreviewState | null = state()) {
  const fetch = vi.fn(() => { throw new Error('La vista previa no puede hacer solicitudes de agenda') })
  const dom = new JSDOM(buildAgendaEditorPreview(html, '', 'site', config), { runScripts: 'dangerously', url: 'http://localhost/editor-preview', beforeParse(window) { window.fetch = fetch } })
  windows.push(dom); await settle(); return { window: dom.window, document: dom.window.document, fetch }
}
afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); vi.restoreAllMocks() })
describe('Agenda en preview del editor, runtime real sin red', () => {
  it('página sin marcadores conserva exactamente el documento y puente anterior', () => {
    expect(buildAgendaEditorPreview('<form data-flow-form="f"><input name="nombre"></form>', 'body{padding:8px}', 's', state())).toBe(buildPreviewDocument('<form data-flow-form="f"><input name="nombre"></form>', 'body{padding:8px}'))
  })
  it('inline muestra ejemplos, acento normalizado y flujo completo sin petición pública', async () => {
    const { document, window, fetch } = await preview('{{agenda-component}}')
    const host = document.querySelector<HTMLElement>('[data-flow-agenda="inline"]')!, root = host.shadowRoot!
    expect(root.textContent).toContain('Servicio de ejemplo')
    expect(document.body.textContent).toContain('Vista previa con datos de ejemplo')
    expect(host.style.getPropertyValue('--flow-agenda-accent')).toBe('#aabbcc')
    for (let i = 0; i < 3 && !root.querySelector('.slots'); i++) { root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle() }
    expect(root.textContent).toContain('10:00')
    root.querySelector<HTMLButtonElement>('.slots button')!.click()
    root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await settle()
    for (const [name, value] of [['name', 'Demo'], ['email', 'demo@example.test']]) {
      const input = root.querySelector<HTMLInputElement>(`[name=${name}]`)!
      input.value = value!; input.dispatchEvent(new window.Event('input'))
    }
    vi.spyOn(window.Date, 'now').mockReturnValue(window.Date.now() + 3000)
    root.querySelector('form')!.dispatchEvent(new window.Event('submit', { cancelable: true })); await settle()
    expect(root.textContent).toContain('¡Listo, tu cita está confirmada!')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('openAgenda abre el modal del mismo runtime sin consultar la API', async () => {
    const { document, fetch } = await preview('<button {{openAgenda}}>Abrir agenda</button>')
    document.querySelector<HTMLButtonElement>('button[data-flow-agenda-open]')!.click(); await settle()
    const host = document.querySelector<HTMLElement>('body > div')!
    expect(host.shadowRoot?.querySelector('[role=dialog]')).not.toBeNull()
    expect(host.shadowRoot?.textContent).toContain('Servicio de ejemplo')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['Activa la agenda para este sitio.', 'Agrega al menos un servicio visible.', 'Define el horario de al menos una persona visible.'])('no lista: %s, sin runtime público', async reason => {
    const config = state(); config.missing = [reason]
    const { document, fetch } = await preview('{{agenda-component}}<button {{openAgenda}}>Abrir</button>', config)
    const roots = [...document.querySelectorAll('body > div')].map(host => host.shadowRoot).filter(Boolean)
    expect(roots).toHaveLength(2); expect(roots[0]?.textContent).toContain(reason)
    expect(roots[0]?.querySelector('a')?.getAttribute('href')).toBe('/sites/site/agenda')
    expect(document.querySelector('[data-flow-agenda-runtime]')).toBeNull()
    document.querySelector<HTMLButtonElement>('button')!.click(); await settle()
    expect(document.querySelector('[data-flow-agenda-open]')).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
  it('configuración ausente informa el motivo y marcador inválido produce aviso escapado', async () => {
    const unavailable = await preview('{{agenda-component}}', null)
    expect(unavailable.document.querySelector('body > div')?.shadowRoot?.textContent).toContain('No pudimos comprobar')
    const invalid = await preview('{{agenda-component otro="<img onerror=x>"}}')
    expect(invalid.document.body.textContent).toContain('Marcador de agenda desconocido')
    expect(invalid.document.querySelector('img')).toBeNull(); expect(invalid.fetch).not.toHaveBeenCalled()
  })
  it('editor conserva oscuro, sandbox, viewports, zoom y puente de formularios', () => {
    const source = readFileSync('pages/sites/[siteId]/pages/[pageId].vue', 'utf8')
    expect(source).toContain('darkReady: true'); expect(source).toContain('theme-light')
    expect(source).toContain('buildAgendaEditorPreview(serializedHtml(), form.css, siteId, page.value?.agendaPreview)')
    expect(source).toContain('sandbox="allow-scripts allow-forms allow-modals"')
    expect(source).toContain('event.source === previewFrame.value?.contentWindow')
    expect(source).toContain("previewWidth.value}px"); expect(source).toContain('previewZoom.value / 100')
    expect(source).toContain('sendPreviewSelection'); expect(source).not.toContain('/api/public/agenda')
  })
})
