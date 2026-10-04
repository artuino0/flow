/** Cabeceras de fetch de navegador; el documento público usa no-referrer. */
export function agendaBrowserHeaders(documentUrl: string, input: string, init: RequestInit = {}) {
  const document = new URL(documentUrl), target = new URL(input, document)
  const sameOrigin = target.origin === document.origin
  const method = (init.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = Object.fromEntries(new Headers(init.headers).entries())
  // Origin, Referer y Sec-Fetch-* son controlados por el navegador.
  delete headers.origin; delete headers.referer
  headers.host = target.host
  headers['sec-fetch-site'] = sameOrigin ? 'same-origin' : 'cross-site'
  headers['sec-fetch-mode'] = 'cors'
  headers['sec-fetch-dest'] = 'empty'
  if (method !== 'GET' && method !== 'HEAD' || !sameOrigin) headers.origin = document.origin
  if (init.referrerPolicy === 'same-origin' && sameOrigin) {
    const referrer = init.referrer ? new URL(init.referrer, document) : document
    referrer.hash = ''; referrer.username = ''; referrer.password = ''
    headers.referer = referrer.href
  }
  return headers
}
