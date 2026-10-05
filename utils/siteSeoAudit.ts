import type { SiteSeo } from './siteSeo'

export interface SeoAuditItem { id: string; group: string; state: 'ok' | 'aviso' | 'falta'; text: string; fix: string; target?: string }
export interface SeoAuditPage { id: string; title: string; path: string; status: string; html: string; css: string; seo: SiteSeo }
export interface SeoAuditSite {
  locale: string; domainActive: boolean; primary: boolean; googleVerified: boolean; rootPath: string
  hostname?: string
  pages: SeoAuditPage[]; assets: Array<{ id: string; fileName: string; sizeBytes: number }>
}
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '']))
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, ' ').replace(/\s+/g, ' ').trim()
function authorMeta(html: string, name: string) {
  for (const tag of html.match(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) ?? []) {
    const attributes = attrs(tag)
    if ((attributes.name ?? attributes.property)?.toLowerCase() === name) return attributes.content ?? ''
  }
  return ''
}
export function auditSiteSeo(page: SeoAuditPage, site: SeoAuditSite) {
  const items: SeoAuditItem[] = []
  const add = (id: string, group: string, state: SeoAuditItem['state'], text: string, fix: string, target?: string) => items.push({ id, group, state, text, fix, target })
  if (page.html.length > 200000 || page.css.length > 100000 || site.pages.length > 1000 || site.assets.length > 5000) {
    add('limits', 'Técnica', 'aviso', 'El contenido excede el límite del análisis.', 'Reduce HTML y CSS o divide el sitio antes de volver a analizar.')
    return { items, ready: 0, total: 1 }
  }
  // Nunca ejecuta HTML. Retira comentarios y contenido no visible antes de contar.
  const html = page.html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
  const titleFor = (row: SeoAuditPage) => row.seo.title ?? plain(row.html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? row.title)
  const descriptionFor = (row: SeoAuditPage) => row.seo.description ?? authorMeta(row.html, 'description')
  const title = titleFor(page), description = descriptionFor(page)
  add('title', 'Básico', !title ? 'falta' : title.length < 30 || title.length > 60 ? 'aviso' : 'ok', 'Título de búsqueda', 'Escribe un título específico de 30 a 60 caracteres.', 'seo-title')
  add('description', 'Básico', !description ? 'falta' : description.length < 70 || description.length > 160 ? 'aviso' : 'ok', 'Descripción de búsqueda', 'Resume el contenido en 70 a 160 caracteres.', 'seo-description')
  const signature = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  add('duplicates', 'Básico', site.pages.some(row => row.id !== page.id && ((title && signature(titleFor(row)) === signature(title)) || (description && signature(descriptionFor(row)) === signature(description)))) ? 'aviso' : 'ok', 'Título y descripción únicos', 'Diferencia el título y la descripción de cada página.', 'seo-title')
  add('locale', 'Básico', site.locale ? 'ok' : 'falta', 'Idioma del sitio', 'Elige el idioma en Configuración del sitio.')
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map(match => Number(match[1]))
  const h1 = headings.filter(level => level === 1).length
  add('h1', 'Contenido', h1 === 1 ? 'ok' : h1 === 0 ? 'falta' : 'aviso', 'Un encabezado principal', 'Deja exactamente un h1 que describa la página.')
  add('headings', 'Contenido', headings.some((level, index) => level > (headings[index - 1] ?? 0) + 1) ? 'aviso' : 'ok', 'Orden de encabezados', 'Ordena h1, h2 y h3 sin saltar niveles.')
  const body = html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
  const words = plain(body).split(/\s+/).filter(Boolean).length
  add('text', 'Contenido', words >= 300 ? 'ok' : 'aviso', `${words} palabras de contenido`, 'Añade contenido útil y propio; menos de unas 300 palabras puede ser insuficiente.')
  const links = [...body.matchAll(/<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a\s*>/gi)].map(match => ({ href: attrs(match[1]!).href ?? '', text: plain(match[2]!) }))
  const internal = links.flatMap(link => {
    if (!link.href || link.href.startsWith('#')) return []
    try {
      const origin = `https://${site.hostname ?? 'sitio.invalid'}`
      const url = new URL(link.href, origin + page.path)
      return url.origin === origin ? [url.pathname.replace(/\/$/, '') || '/'] : []
    } catch { return [] }
  })
  add('links', 'Contenido', internal.some(path => path !== page.path) ? 'ok' : 'aviso', 'Enlaces a otras páginas', 'Incluye enlaces útiles a otras páginas de tu sitio.')
  add('broken', 'Contenido', internal.some(path => !site.pages.some(row => (row.path === path || (path === '/' && row.path === site.rootPath)) && row.status === 'published')) ? 'falta' : 'ok', 'Enlaces internos publicados', 'Corrige la ruta del enlace o publica la página de destino.')
  add('generic', 'Contenido', links.some(link => /^(clic aquí|click aquí|aquí|leer más|ver más)$/i.test(link.text)) ? 'aviso' : 'ok', 'Textos de enlace descriptivos', 'Sustituye «clic aquí» por el nombre o propósito del destino.')
  const images = (body.match(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) ?? []).map(attrs)
  add('alt', 'Imágenes', images.some(image => !Object.hasOwn(image, 'alt')) ? 'falta' : 'ok', 'Texto alternativo de imágenes', 'Añade alt descriptivo; usa alt vacío solo en imágenes decorativas.')
  add('dimensions', 'Imágenes', images.some(image => !/^\d+$/.test(image.width ?? '') || !/^\d+$/.test(image.height ?? '')) ? 'aviso' : 'ok', 'Tamaño reservado de imágenes', 'Define width y height para evitar saltos del contenido.')
  add('heavy', 'Imágenes', site.assets.some(asset => asset.sizeBytes > 500000 && images.some(image => { try { return decodeURIComponent(image.src ?? '').split('/').pop() === asset.fileName } catch { return false } })) ? 'aviso' : 'ok', 'Peso de imágenes', 'Reduce los activos de más de 500 KB que usa esta página.')
  const social = site.assets.find(asset => asset.id === page.seo.ogImageAssetId)
  const authorImage = authorMeta(page.html, 'og:image')
  add('socialImage', 'Imágenes', social || authorImage ? 'aviso' : 'falta', social || authorImage ? 'Imagen social definida; proporción pendiente de revisar' : 'Falta imagen social', 'Elige una imagen del sitio y comprueba que sea aproximadamente 1,91:1 (por ejemplo, 1200 × 630).', 'seo-image')
  const og = !!(page.seo.ogTitle || title) && !!(page.seo.ogDescription || description) && !!(social || authorImage) && site.domainActive
  add('sharing', 'Compartir', og ? 'ok' : 'falta', 'Tarjeta social', 'Completa título, descripción e imagen social y conecta un dominio.', 'seo-ogTitle')
  const twitter = page.seo.twitterCard ?? authorMeta(page.html, 'twitter:card')
  add('twitter', 'Compartir', og && (twitter === 'summary' || twitter === 'summary_large_image' || !twitter) ? 'ok' : 'falta', 'Tarjeta de Twitter', 'Completa la tarjeta social y elige el formato de Twitter.', 'seo-twitter')
  const noindex = page.seo.noindex === true || (page.seo.noindex === undefined && /\bnoindex\b/i.test(authorMeta(page.html, 'robots')))
  add('published', 'Indexación', page.status === 'published' ? 'ok' : 'falta', 'Página publicada', 'Guarda y publica la página.')
  add('noindex', 'Indexación', noindex ? 'aviso' : 'ok', noindex ? 'Google no mostrará esta página' : 'Indexación permitida', 'Desactiva noindex si quieres que aparezca en buscadores.', 'seo-noindex')
  const canonical = page.seo.canonicalPath
  add('canonical', 'Indexación', site.domainActive && (!canonical || /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(canonical)) ? 'ok' : 'falta', 'Dirección canónica', 'Conecta un dominio y usa una ruta del mismo sitio.', 'seo-canonical')
  add('sitemap', 'Indexación', site.domainActive && page.status === 'published' && !noindex ? 'ok' : 'falta', 'Inclusión en sitemap', 'Publica la página en un dominio activo y permite su indexación.')
  add('domain', 'Sitio', site.domainActive ? 'ok' : 'falta', site.domainActive ? 'Dominio verificado y certificado activo' : 'Sin dominio activo, la página no es pública y no puede posicionar', 'Conecta y verifica el dominio desde Dominios y URLs.')
  add('primary', 'Sitio', site.primary ? 'ok' : 'falta', 'Dominio principal', 'Marca un dominio activo como principal.')
  add('google', 'Sitio', site.googleVerified ? 'ok' : 'falta', 'Código de Search Console', 'Guarda el token de Google en Configuración del sitio.')
  add('home', 'Sitio', site.pages.some(row => row.path === site.rootPath && row.status === 'published') ? 'ok' : 'falta', 'Inicio publicado', 'Publica la página de inicio del dominio principal.')
  // El servidor añade viewport a todas las páginas, incluso sin head del autor.
  add('viewport', 'Técnica', 'ok', 'Vista móvil configurada', 'Flow añade viewport al documento publicado.')
  add('mixed', 'Técnica', /(?:src|href)\s*=\s*["']http:\/\//i.test(page.html) || /url\(\s*["']?http:\/\//i.test(page.css) ? 'aviso' : 'ok', 'Recursos seguros', 'Cambia los recursos http:// por https://.')
  add('weight', 'Técnica', new TextEncoder().encode(page.html + page.css).length > 150000 ? 'aviso' : 'ok', 'Peso del documento', 'Reduce HTML y CSS si superan 150 KB.')
  const blocking = (page.html.match(/<script\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) ?? []).some(tag => attrs(tag).src && !/\b(?:async|defer)\b/i.test(tag) && attrs(tag).type !== 'module')
  add('scripts', 'Técnica', blocking ? 'aviso' : 'ok', 'Carga de scripts', 'Añade defer o async a los scripts externos cuando sea compatible.')
  const rank = { falta: 0, aviso: 1, ok: 2 }
  items.sort((a, b) => rank[a.state] - rank[b.state])
  return { items, ready: items.filter(item => item.state === 'ok').length, total: items.length }
}
export type SiteSeoAudit = ReturnType<typeof auditSiteSeo>
