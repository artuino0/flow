/** Inspección inerte del HTML del autor, antes de inyectar scripts de Flow. */
export function hasSiteAuthorScripts(html: string): boolean {
  const lower = html.toLowerCase()
  let i = 0
  const decode = (value: string) => value.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code: string) => {
    const number = code[0]!.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ''
  }).replace(/&colon;/gi, ':').replace(/&(?:tab|newline);/gi, '').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      if (html[i + 4] === '>' || html.slice(i + 4, i + 6) === '->') { i = html.indexOf('>', i + 4) + 1; continue }
      const normal = html.indexOf('-->', i + 4), alternate = html.indexOf('--!>', i + 4)
      const end = normal < 0 ? alternate : alternate < 0 ? normal : Math.min(normal, alternate)
      i = end < 0 ? i + 4 : end + (end === alternate ? 4 : 3); continue
    }
    if (html[i] !== '<') { i++; continue }
    const tag = /^<([a-z][\w:-]*)\b/i.exec(html.slice(i))
    if (!tag) { i++; continue }
    const name = tag[1]!.toLowerCase()
    if (name === 'script') return true
    let cursor = i + tag[0].length
    while (cursor < html.length && html[cursor] !== '>') {
      if (/[\s/]/.test(html[cursor]!)) { cursor++; continue }
      const start = cursor
      while (cursor < html.length && !/[\s=/>]/.test(html[cursor]!)) cursor++
      const attribute = html.slice(start, cursor).toLowerCase()
      if (/^on[a-z]+$/.test(attribute)) return true
      while (/\s/.test(html[cursor] ?? '')) cursor++
      if (html[cursor] !== '=') continue
      cursor++; while (/\s/.test(html[cursor] ?? '')) cursor++
      const quote = html[cursor], quoted = quote === '"' || quote === "'"
      if (quoted) cursor++
      const valueStart = cursor
      while (cursor < html.length && (quoted ? html[cursor] !== quote : !/[\s>]/.test(html[cursor]!))) cursor++
      const value = decode(html.slice(valueStart, cursor))
      if (quoted && cursor < html.length) cursor++
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(attribute) && /^javascript:/i.test(value.replace(/[\u0000-\u0020]/g, ''))) return true
      if (attribute === 'srcdoc' && hasSiteAuthorScripts(value)) return true
      if (['iframe', 'object', 'embed'].includes(name) && ['src', 'data'].includes(attribute) && /^data:(?:text\/html|image\/svg\+xml)/i.test(value)) return true
    }
    i = Math.min(cursor + 1, html.length)
    if (['style', 'textarea', 'title', 'xmp'].includes(name)) {
      const end = lower.indexOf(`</${name}`, i), finish = end < 0 ? -1 : html.indexOf('>', end)
      i = finish < 0 ? html.length : finish + 1
    }
  }
  return false
}
