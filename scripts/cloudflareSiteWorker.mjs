// Worker de borde: configurar CLOUDFLARE_EDGE_SECRET como binding secreto.
const ORIGIN = 'https://app.dydasoftware.com'
const EXCLUDED = new Set(['app.dydasoftware.com', 'customers.dydasoftware.com'])
const PRIVATE_HEADERS = ['X-Flow-Original-Host', 'X-Flow-Client-IP', 'X-Forwarded-Host', 'X-Flow-Edge-Secret']

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url)
    const visitorIp = request.headers.get('CF-Connecting-IP')
    const headers = new Headers(request.headers)
    for (const name of PRIVATE_HEADERS) headers.delete(name)
    if (EXCLUDED.has(incoming.hostname.toLowerCase())) {
      return fetch(new Request(request, { headers, redirect: 'manual' }))
    }
    if (!env.CLOUDFLARE_EDGE_SECRET) return new Response('Borde no configurado.', { status: 503 })
    headers.set('X-Flow-Original-Host', incoming.host)
    headers.set('X-Flow-Client-IP', visitorIp || '')
    headers.set('X-Forwarded-Host', incoming.host)
    headers.set('X-Flow-Edge-Secret', env.CLOUDFLARE_EDGE_SECRET)
    const target = new URL(ORIGIN)
    target.pathname = incoming.pathname
    target.search = incoming.search
    const upstream = new Request(new Request(target, request), { headers, redirect: 'manual' })
    // Sin caché compartida bajo el host de app; el navegador conserva su URL.
    return fetch(upstream, { cf: { cacheEverything: false, cacheTtl: 0 } })
  },
}
