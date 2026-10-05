import { escapeSeo, siteCanonicalPath, siteVerificationSchema } from '~/utils/siteSeo'
import type { PublicSitePage } from './siteDomains'

export interface PublicSeoContext {
  origin: string
  rootPath: string
  imagePath?: string
  imageAlt?: string
  verification?: unknown
  preview?: boolean
}
// Solo se procesa head. Los scripts, comentarios y atributos con > no son etiquetas SEO.
const headToken = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<title\b[^>]*>[\s\S]*?<\/title\s*>|<(?:meta|link)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi
function attributes(tag: string) {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  return result
}
function tokenKey(tag: string) {
  if (/^<title\b/i.test(tag)) return 'title'
  if (/^<meta\b/i.test(tag)) { const attrs = attributes(tag); return (attrs.name ?? attrs.property ?? '').toLowerCase() }
  if (/^<link\b/i.test(tag) && attributes(tag).rel?.toLowerCase() === 'canonical') return 'canonical'
  return ''
}
function authorTags(html: string) {
  const result = new Map<string, string>()
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? ''
  for (const match of head.matchAll(headToken)) {
    const key = tokenKey(match[0])
    if (key && !result.has(key)) result.set(key, match[0])
  }
  return result
}
function decodeAttribute(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' }[entity]!))
}
export function sitePageNoindex(seo: Record<string, unknown>, html = '') {
  return Object.hasOwn(seo, 'noindex') ? seo.noindex === true : /\bnoindex\b/i.test(attributes(authorTags(html).get('robots') ?? '').content ?? '')
}
function sitePageCanonical(origin: string, rootPath: string, pagePath: string, seo: Record<string, unknown>, html: string) {
  const authored = authorTags(html).get('canonical')
  if (!Object.hasOwn(seo, 'canonicalPath') && authored) {
    try {
      const url = new URL(decodeAttribute(attributes(authored).href ?? ''), origin)
      if (url.origin === origin && /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(url.pathname) && !url.search && !url.hash) return origin + siteCanonicalPath(url.pathname)
    } catch { /* Se usa la ruta segura de la página. */ }
  }
  const path = typeof seo.canonicalPath === 'string' && /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(seo.canonicalPath) ? seo.canonicalPath : pagePath === rootPath ? '/' : pagePath
  return origin + siteCanonicalPath(path)
}
export function publicSeoHead(page: PublicSitePage, context?: PublicSeoContext) {
  const seo = page.seo ?? {}, explicit = (key: string) => Object.hasOwn(seo, key)
  const authored = authorTags(page.html)
  const authorTitle = authored.get('title')?.replace(/^<title\b[^>]*>|<\/title\s*>$/gi, '')
  const title = String(seo.title || (explicit('title') ? page.pageTitle : authorTitle ? decodeAttribute(authorTitle) : page.pageTitle))
  const description = String(explicit('description') ? seo.description || '' : decodeAttribute(attributes(authored.get('description') ?? '').content ?? ''))
  const tags = new Map<string, { tag: string; override: boolean }>()
  const meta = (key: string, value: string, override = false, property = false) => tags.set(key, { tag: `<meta ${property ? 'property' : 'name'}="${key}" content="${escapeSeo(value)}">`, override })
  tags.set('title', { tag: `<title>${escapeSeo(title)}</title>`, override: explicit('title') })
  if (description || explicit('description')) meta('description', description, explicit('description'))
  const authorRobots = attributes(authorTags(page.html).get('robots') ?? '').content ?? ''
  const directives = [sitePageNoindex(seo, page.html) ? 'noindex' : 'index', (explicit('nofollow') ? seo.nofollow === true : /\bnofollow\b/i.test(authorRobots)) ? 'nofollow' : 'follow'].join(',')
  if (context?.preview) meta('robots', 'noindex, nofollow', true)
  else if (explicit('noindex') || explicit('nofollow')) meta('robots', directives, true)
  if (context && !context.preview && context.origin) {
    const path = page.pagePath === context.rootPath ? '/' : page.pagePath
    const url = sitePageCanonical(context.origin, context.rootPath, page.pagePath, seo, page.html)
    tags.set('canonical', { tag: `<link rel="canonical" href="${escapeSeo(url)}">`, override: explicit('canonicalPath') })
    meta('og:type', 'website', false, true)
    meta('og:title', String(seo.ogTitle ?? title), explicit('ogTitle'), true)
    meta('og:description', String(seo.ogDescription ?? description), explicit('ogDescription'), true)
    meta('og:url', url, explicit('canonicalPath'), true)
    meta('og:site_name', page.siteName, false, true)
    meta('og:locale', page.siteLocale.replace('-', '_'), false, true)
    meta('twitter:card', String(seo.twitterCard ?? 'summary'), explicit('twitterCard'))
    meta('twitter:title', String(seo.ogTitle ?? title), explicit('ogTitle'))
    meta('twitter:description', String(seo.ogDescription ?? description), explicit('ogDescription'))
    if (context.imagePath) {
      meta('og:image', context.origin + context.imagePath, explicit('ogImageAssetId'), true)
      meta('twitter:image', context.origin + context.imagePath, explicit('ogImageAssetId'))
      meta('og:image:alt', context.imageAlt ?? '', explicit('ogImageAssetId'), true)
      meta('twitter:image:alt', context.imageAlt ?? '', explicit('ogImageAssetId'))
    } else if (explicit('ogImageAssetId')) {
      for (const key of ['og:image', 'twitter:image', 'og:image:alt', 'twitter:image:alt']) tags.set(key, { tag: '', override: true })
    }
    if (path === '/') {
      const verification = siteVerificationSchema.safeParse(context.verification)
      if (verification.success) {
        if (verification.data.google) meta('google-site-verification', verification.data.google, true)
        if (verification.data.bing) meta('msvalidate.01', verification.data.bing, true)
      }
    }
  }
  const seen = new Set<string>()
  let html = page.html.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head\s*>)/i, (_all, open: string, head: string, close: string) => {
    const cleaned = head.replace(headToken, tag => {
      const key = tokenKey(tag)
      if (context && !context.preview && (key === 'canonical' || key === 'og:url')) {
        const value = decodeAttribute(attributes(tag)[key === 'canonical' ? 'href' : 'content'] ?? '')
        try { if (new URL(value, context.origin).origin !== context.origin) return '' } catch { return '' }
        if (key === 'canonical' && value !== sitePageCanonical(context.origin, context.rootPath, page.pagePath, seo, page.html)) return ''
      }
      if (!key || (!tags.has(key) && !key.startsWith('og:') && !key.startsWith('twitter:'))) return tag
      if (tags.get(key)?.override || seen.has(key) || (context?.preview && key === 'canonical')) return ''
      seen.add(key); return tag
    })
    return open + cleaned + close
  })
  // La vista previa nunca conserva el canónico escrito por el autor.
  if (context?.preview) html = html.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head\s*>)/i, (_all, open: string, head: string, close: string) => open + head.replace(headToken, tag => tokenKey(tag) === 'canonical' ? '' : tag) + close)
  return { html, meta: [...tags].filter(([key]) => !seen.has(key)).map(([, value]) => value.tag).join('') }
}
export function renderSiteSitemap(origin: string, rootPath: string, pages: Array<{ path: string; seo: Record<string, unknown>; lastmod: string; html?: string }>) {
  const seen = new Set<string>()
  const urls = pages.filter(page => !(rootPath !== '/' && page.path === '/') && !sitePageNoindex(page.seo, page.html)).slice(0, 50000).flatMap(page => {
    const loc = sitePageCanonical(origin, rootPath, page.path, page.seo, page.html ?? '')
    if (seen.has(loc)) return []
    seen.add(loc)
    return [`<url><loc>${escapeSeo(loc)}</loc><lastmod>${escapeSeo(new Date(page.lastmod).toISOString())}</lastmod></url>`]
  })
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`
}
export function renderSiteRobots(origin?: string) { return origin ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n' }
