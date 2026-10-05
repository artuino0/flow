// Referencia congelada de 1f8803e para equivalencia; no usar en producción.
/** Gramática V1: nombres tolerantes; parámetros servicio/personal entre comillas. */
export interface AgendaMarker { start: number; end: number; kind: 'inline' | 'open' | 'invalid'; raw: string; params: Partial<Record<'servicio' | 'personal', string>>; attribute: boolean }
export interface AgendaMarkerConfig { enabled: boolean; services: Array<{ id: string; name: string }>; people: Array<{ id: string; name: string }>; mode?: string }
export const escapeAgendaText = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export function agendaAlias(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '-') }

function marker(source: string, start: number, attribute: boolean): AgendaMarker | null {
  if (!source.startsWith('{{', start)) return null
  const close = source.indexOf('}}', start + 2)
  const end = close < 0 ? source.length : close + 2
  const raw = source.slice(start, end)
  if (!/^\{\{\s*(?:agenda|openagenda)/i.test(raw)) return null
  const result: AgendaMarker = { start, end, raw, kind: 'invalid', params: {}, attribute }
  if (close < 0) return result
  const match = /^\{\{\s*(agenda-component|openagenda)\b([\s\S]*?)\}\}$/i.exec(raw)
  if (!match) return result
  let rest = match[2]!
  while (rest.trim()) {
    const param = /^\s+(servicio|personal)\s*=\s*(?:"([^"<>\r\n{}]*)"|'([^'<>\r\n{}]*)')/i.exec(rest)
    if (!param) return result
    const key = param[1]!.toLowerCase() as 'servicio' | 'personal'
    if (result.params[key] !== undefined) return result
    result.params[key] = param[2] ?? param[3] ?? ''
    rest = rest.slice(param[0].length)
  }
  result.kind = match[1]!.toLowerCase() === 'openagenda' ? 'open' : 'inline'
  if ((result.kind === 'open') !== attribute) result.kind = 'invalid'
  return result
}

/** Escáner con estados HTML; nunca interpreta texto en comentarios, raw text o atributos. */
export function previousAnalyzeAgendaMarkers(html: string): AgendaMarker[] {
  const found: AgendaMarker[] = []
  if (!html.includes('{{')) return found
  let i = 0
  const lower = html.toLowerCase()
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i + 4); i = end < 0 ? html.length : end + 3; continue }
    if (html[i] === '<') {
      const tag = /^<\/?([a-z][\w:-]*)\b/i.exec(html.slice(i))
      if (!tag) { i++; continue }
      const name = tag[1]!.toLowerCase()
      const closing = html[i + 1] === '/'
      let cursor = i + tag[0].length
      while (cursor < html.length && html[cursor] !== '>') {
        if (/\s/.test(html[cursor]!)) { cursor++; continue }
        const candidate = marker(html, cursor, true)
        if (candidate) {
          const standalone = /\s/.test(html[cursor - 1]!) && /[\s/>]/.test(html[candidate.end] ?? '>')
          if (closing || !['button', 'a'].includes(name) || !standalone) candidate.kind = 'invalid'
          found.push(candidate); cursor = candidate.end; continue
        }
        // Leer un atributo entero, incluido su valor quoted/unquoted.
        while (cursor < html.length && !/[\s=>]/.test(html[cursor]!)) {
          const embedded = marker(html, cursor, true)
          if (embedded) { embedded.kind = 'invalid'; found.push(embedded); cursor = embedded.end } else cursor++
        }
        while (/\s/.test(html[cursor] ?? '')) cursor++
        if (html[cursor] === '=') {
          cursor++; while (/\s/.test(html[cursor] ?? '')) cursor++
          const quote = html[cursor]
          if (quote === '"' || quote === "'") { cursor++; while (cursor < html.length && html[cursor] !== quote) cursor++; if (cursor < html.length) cursor++ }
          else while (cursor < html.length && !/[\s>]/.test(html[cursor]!)) cursor++
        }
      }
      i = Math.min(cursor + 1, html.length)
      if (!closing && ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template', 'svg', 'math'].includes(name)) {
        const end = lower.indexOf(`</${name}`, i); const finish = end < 0 ? -1 : html.indexOf('>', end)
        i = finish < 0 ? html.length : finish + 1
      }
      continue
    }
    const candidate = marker(html, i, false)
    if (candidate) { found.push(candidate); i = candidate.end } else i++
  }
  return found
}

