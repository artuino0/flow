/** Gramática V1: nombres tolerantes; parámetros servicio/personal entre comillas. */
export interface AgendaMarker { start: number; end: number; kind: 'inline' | 'open' | 'invalid'; raw: string; params: Partial<Record<'servicio' | 'personal', string>>; attribute: boolean }
export interface AgendaMarkerConfig { enabled: boolean; services: Array<{ id: string; name: string }>; people: Array<{ id: string; name: string }>; mode?: string }
export const escapeAgendaText = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export function agendaAlias(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '-') }

function marker(source: string, start: number, attribute: boolean): AgendaMarker | null {
  if (!source.startsWith('{{', start)) return null
  let prefix = start + 2
  while (isMarkerSpace(source.charCodeAt(prefix))) prefix++
  const head = source.slice(prefix, prefix + 10).toLowerCase()
  if (!head.startsWith('agenda') && !head.startsWith('openagenda')) return null
  const close = source.indexOf('}}', prefix)
  const end = close < 0 ? source.length : close + 2
  const raw = source.slice(start, end)
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

// WhiteSpace/LineTerminator de ECMAScript, sin RegExp por carácter.
function isMarkerSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 5760
    || (code >= 8192 && code <= 8202) || code === 8232 || code === 8233
    || code === 8239 || code === 8287 || code === 12288 || code === 65279
}
const rawTextTags = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template', 'svg', 'math'])

/** Una pasada HTML. Solo se asignan cadenas al reconocer etiquetas o marcadores. */
export function analyzeAgendaMarkers(html: string): AgendaMarker[] {
  const found: AgendaMarker[] = []
  if (!html.includes('{{')) return found
  // Instancia por análisis: lastIndex nunca se comparte entre llamadas.
  const tagPattern = /<\/?([a-z][\w:-]*)\b/iy
  // Convertir solo al entrar en raw text y retener el resultado. En Node 22,
  // TurboFan puede hundir una conversión ansiosa dentro del bucle (ERD-194).
  let lower: string | undefined
  let i = 0
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      i = end < 0 ? html.length : end + 3
      continue
    }
    if (html.charCodeAt(i) === 60) {
      tagPattern.lastIndex = i
      const tag = tagPattern.exec(html)
      if (!tag) { i++; continue }
      const name = tag[1]!.toLowerCase()
      const closing = html.charCodeAt(i + 1) === 47
      let cursor = tagPattern.lastIndex
      while (cursor < html.length && html.charCodeAt(cursor) !== 62) {
        if (isMarkerSpace(html.charCodeAt(cursor))) { cursor++; continue }
        const candidate = marker(html, cursor, true)
        if (candidate) {
          const after = html.charCodeAt(candidate.end)
          const standalone = isMarkerSpace(html.charCodeAt(cursor - 1))
            && (candidate.end >= html.length || isMarkerSpace(after) || after === 47 || after === 62)
          if (closing || (name !== 'button' && name !== 'a') || !standalone) candidate.kind = 'invalid'
          found.push(candidate); cursor = candidate.end; continue
        }
        // Nombre del atributo; los marcadores incrustados se conservan como inválidos.
        while (cursor < html.length) {
          const code = html.charCodeAt(cursor)
          if (isMarkerSpace(code) || code === 61 || code === 62) break
          const embedded = marker(html, cursor, true)
          if (embedded) { embedded.kind = 'invalid'; found.push(embedded); cursor = embedded.end }
          else cursor++
        }
        while (isMarkerSpace(html.charCodeAt(cursor))) cursor++
        if (html.charCodeAt(cursor) === 61) {
          cursor++; while (isMarkerSpace(html.charCodeAt(cursor))) cursor++
          const quote = html.charCodeAt(cursor)
          if (quote === 34 || quote === 39) {
            const end = html.indexOf(String.fromCharCode(quote), cursor + 1)
            cursor = end < 0 ? html.length : end + 1
          } else {
            while (cursor < html.length && !isMarkerSpace(html.charCodeAt(cursor)) && html.charCodeAt(cursor) !== 62) cursor++
          }
        }
      }
      i = Math.min(cursor + 1, html.length)
      if (!closing && rawTextTags.has(name)) {
        lower ??= html.toLowerCase()
        const end = lower.indexOf(`</${name}`, i)
        const finish = end < 0 ? -1 : html.indexOf('>', end)
        i = finish < 0 ? html.length : finish + 1
      }
      continue
    }
    const candidate = marker(html, i, false)
    if (candidate) { found.push(candidate); i = candidate.end } else i++
  }
  return found
}

export function transformAgendaMarkers(html: string, config: AgendaMarkerConfig, markers: AgendaMarker[] = analyzeAgendaMarkers(html)) {
  const warnings: string[] = []
  let cursor = 0, output = '', inline = 0, active = 0
  if (markers.length && !config.enabled) warnings.push('Advertencia fuerte: esta página contiene marcadores y la agenda está desactivada.')
  if (markers.length && (!config.services.length || !config.people.length)) warnings.push('No hay servicios o personal con horario disponibles para la agenda.')
  for (const item of markers) {
    output += html.slice(cursor, item.start); cursor = item.end
    if (item.kind === 'invalid') { warnings.push('Marcador de agenda desconocido, mal formado o fuera de contexto.'); output += escapeAgendaText(item.raw); continue }
    if (item.kind === 'inline' && ++inline > 1) { warnings.push('Solo se admite un agenda-component por página.'); output += escapeAgendaText(item.raw); continue }
    const attrs: string[] = []
    for (const [key, value] of Object.entries(item.params)) {
      if (key === 'personal' && config.mode === 'auto') { warnings.push('El parámetro personal se ignoró porque la asignación del sitio es automática.'); continue }
      const list = key === 'servicio' ? config.services : config.people
      const match = list.find(row => row.id === value || agendaAlias(row.name) === agendaAlias(value))
      if (match) attrs.push(`data-flow-agenda-${key}="${escapeAgendaText(match.id)}"`)
      else warnings.push(`El parámetro ${key}="${value}" no existe en la configuración visible; se ignoró.`)
    }
    if (!config.enabled) { output += escapeAgendaText(item.raw); continue }
    active++
    output += item.kind === 'inline' ? `<div data-flow-agenda="inline" ${attrs.join(' ')}></div>` : `data-flow-agenda-open ${attrs.join(' ')}`
  }
  output += html.slice(cursor)
  return { html: output, markers, warnings: [...new Set(warnings)], active }
}
