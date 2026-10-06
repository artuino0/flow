import { analyzeAgendaMarkers } from '~/utils/agendaMarkers'
import { defineEventHandler, getRequestURL, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { getSiteSeoDomainContext, getSiteSitemapPages, publicSiteSeoContext } from '~/server/utils/siteSeoPublic'
import { renderSiteRobots, renderSiteSitemap } from '~/server/utils/siteSeoDocument'
import { effectiveRequestHostname } from '~/server/utils/effectiveHost'
import { isReservedSiteHostname } from '~/server/utils/siteDomainHostnames'
import { siteRelativeAssetName, siteRequestHasTraversal } from '~/utils/siteAssetPath'
import { sendRelativeSiteAsset, sitePublicNotFound } from '~/server/utils/publicSiteAssets'
import { normalizeSitePath } from '~/server/utils/sites'
import { isActiveSiteDomain, renderPublicSiteDocument, resolvePublishedDomain } from '~/server/utils/siteDomains'
import { protectSiteAgendaDocument, siteAgendaPresentation } from '~/server/utils/siteAgenda'
import { publicAccountBlocked } from '~/server/utils/accountLifecycle'

export default defineEventHandler(async event => {
  const path = getRequestURL(event).pathname
  if (path.startsWith('/api/') || path.startsWith('/_nuxt/') || path.startsWith('/site-preview/') || path.startsWith('/agenda-manage/') || path === '/.well-known/flow-site-edge') return
  const hostname = effectiveRequestHostname(event)
  const discovery = path === '/robots.txt' || path === '/sitemap.xml'
  if (!hostname || isReservedSiteHostname(hostname) || hostname === 'app.dydasoftware.com') {
    if (path === '/robots.txt') { setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8'); return renderSiteRobots() }
    if (path === '/sitemap.xml') return sitePublicNotFound(event)
    return
  }
  if (await publicAccountBlocked(hostname)) {
    setResponseStatus(event, 503)
    setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow')
    setResponseHeader(event, 'cache-control', 'no-store')
    setResponseHeader(event, 'retry-after', 3600)
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Sitio no disponible</title></head><body><h1>Sitio no disponible</h1><p>Vuelve a intentarlo más tarde.</p></body></html>'
  }
  if (siteRequestHasTraversal(event.node.req.url ?? '')) {
    if (await isActiveSiteDomain(hostname)) return sitePublicNotFound(event)
    return
  }
  const domain = await getSiteSeoDomainContext(hostname)
  const active = domain?.status === 'active' && !!domain.primary_host
  if (active && hostname !== domain.primary_host) {
    const url = getRequestURL(event)
    return sendRedirect(event, `https://${domain.primary_host}${url.pathname}${url.search}`, 301)
  }
  if (discovery) {
    if (!domain) return sitePublicNotFound(event)
    setResponseHeader(event, 'cache-control', 'public, max-age=60')
    const origin = active && domain.site_status === 'published' ? `https://${domain.primary_host}` : undefined
    if (path === '/robots.txt') {
      setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
      return renderSiteRobots(origin)
    }
    if (!active) return sitePublicNotFound(event)
    setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
    return renderSiteSitemap(`https://${domain.primary_host}`, domain.root_path, await getSiteSitemapPages(hostname))
  }
  let normalizedPath: string | undefined
  try { normalizedPath = normalizeSitePath(path) } catch { normalizedPath = undefined }
  const page = normalizedPath ? await resolvePublishedDomain(hostname, normalizedPath) : null
  if (page) {
    const url = getRequestURL(event)
    const canonicalPath = page.pagePath === domain?.root_path ? '/' : page.pagePath
    if (path !== canonicalPath) return sendRedirect(event, `https://${domain?.primary_host ?? hostname}${canonicalPath}${url.search}`, 301)
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    setResponseHeader(event, 'cache-control', 'public, s-maxage=60, stale-while-revalidate=300')
    const markers = analyzeAgendaMarkers(page.html)
    const agenda = await siteAgendaPresentation(event, page, false, markers)
    if (agenda) setResponseHeader(event, 'cache-control', 'no-store')
    return renderPublicSiteDocument(page, agenda, protectSiteAgendaDocument(event, page, markers), domain && active ? await publicSiteSeoContext(page, domain) : undefined, markers)
  }
  const assetName = /\.[a-z0-9]{2,8}$/i.test(path) || path.startsWith('/assets/') ? siteRelativeAssetName(path) : null
  if (assetName) {
    const root = await resolvePublishedDomain(hostname, '/')
    if (root) return sendRelativeSiteAsset(event, root, path)
  }
  if (await isActiveSiteDomain(hostname)) {
    if (assetName || /\.[a-z0-9]{2,8}$/i.test(path)) return sitePublicNotFound(event)
    setResponseStatus(event, 404)
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página no encontrada</title><meta name="robots" content="noindex"></head><body style="font-family:Inter,system-ui,sans-serif;color:#33475b;padding:64px"><h1>Página no encontrada</h1><p>La ruta solicitada no está publicada.</p></body></html>'
  }
})
