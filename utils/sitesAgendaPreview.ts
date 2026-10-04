import { analyzeAgendaMarkers, escapeAgendaText, transformAgendaMarkers } from './agendaMarkers'
import { agendaAccentPresentation } from './agendaAccent'
import { publicAgendaRuntime } from './publicAgendaRuntime'
import { buildPreviewDocument } from './sitesEditorScript'
import type { AgendaSiteConfig } from './agendaPublic'

export interface AgendaEditorPreviewState {
  settings: AgendaSiteConfig; missing: string[]; assignmentMode: string; timezone: string
}
function previewAgendaUnavailable(missing: string[], agendaPath: string) {
  const hosts = [...document.querySelectorAll<HTMLElement>('[data-flow-agenda="inline"],[data-flow-agenda-open]')]
  for (const host of hosts) {
    const box = document.createElement('div'), root = box.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = ':host{display:block;color-scheme:light;font:14px/1.5 system-ui}section{background:white;color:black;border:1px solid silver;border-radius:10px;padding:20px;margin:12px 0}a{color:navy}'
    const section = document.createElement('section'), title = document.createElement('strong'), list = document.createElement('ul'), link = document.createElement('a')
    title.textContent = 'La agenda todavía no está lista'
    for (const reason of missing) { const row = document.createElement('li'); row.textContent = reason; list.append(row) }
    link.textContent = 'Sites > Agenda'; link.href = agendaPath
    link.addEventListener('click', event => { event.preventDefault(); parent.postMessage({ source: 'flow-sites-agenda-preview', action: 'configure' }, '*') })
    section.append(title, list, link); root.append(style, section)
    if (host.hasAttribute('data-flow-agenda-open')) {
      host.removeAttribute('data-flow-agenda-open'); host.addEventListener('click', event => event.preventDefault()); host.after(box)
    } else host.replaceWith(box)
  }
}

/** Exclusivo del iframe del editor. El documento público no consume este adaptador. */
export function buildAgendaEditorPreview(html: string, css: string, siteId: string, state?: AgendaEditorPreviewState | null) {
  if (!analyzeAgendaMarkers(html).length) return buildPreviewDocument(html, css)
  const transformed = transformAgendaMarkers(html, { enabled: true, services: [{ id: 'demo', name: 'Servicio de ejemplo' }], people: [{ id: 'demo-person', name: 'Persona de ejemplo' }], mode: state?.assignmentMode ?? 'both' })
  const missing = state?.missing ?? ['No pudimos comprobar la configuración de la agenda. Abre Sites > Agenda.']
  const notices = `<aside aria-label="Avisos de agenda" style="color-scheme:light;background:white;color:black;font:12px/1.5 system-ui;padding:8px">Vista previa con datos de ejemplo${transformed.warnings.map(warning => `<p>${escapeAgendaText(warning)}</p>`).join('')}</aside>`
  const runtime = missing.length
    ? `<script>(${previewAgendaUnavailable.toString()})(${JSON.stringify(missing).replace(/</g, '\\u003c')},${JSON.stringify(`/sites/${encodeURIComponent(siteId)}/agenda`)})</script>`
    : publicAgendaRuntime({ site: siteId, page: 'editor-preview', locale: 'es', timezone: state!.timezone,
      accent: agendaAccentPresentation(state!.settings.accent, state!.settings.accentColor).css,
      assignmentMode: state!.assignmentMode, fields: state!.settings.visibleFields, requiredFields: state!.settings.requiredFields, preview: true })
  return buildPreviewDocument(`${notices}${transformed.html}${runtime}`, css)
}
