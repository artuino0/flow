import { defineEventHandler, getHeader, getRequestURL, setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import { siteRelativeAssetName, siteRequestHasTraversal } from '~/utils/siteAssetPath'
import { sendRelativeSiteAsset, sitePublicNotFound } from '~/server/utils/publicSiteAssets'
import { normalizeSitePath } from '~/server/utils/sites'
import { isActiveSiteDomain, renderPublicSiteDocument, resolvePublishedDomain } from '~/server/utils/siteDomains'
import { protectSiteAgendaDocument, siteAgendaPresentation } from '~/server/utils/siteAgenda'

function requestHostname(event: H3Event) {
  const forwarded = getHeader(event, 'x-forwarded-host')?.split(',')[0]?.trim()
  return (forwarded || getHeader(event, 'host') || '').split(':')[0].toLowerCase().replace(/\.$/, '')
}
function reservedHostnames() {
  const values = new Set(['localhost', '127.0.0.1', '::1'])
  for (const raw of [process.env.APP_BASE_URL, process.env.VERCEL_URL, process.env.RAILWAY_PUBLIC_DOMAIN]) {
    if (!raw) continue
    try { values.add(new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase()) } catch { /* configuración incompleta */ }
  }
  return values
}
export default defineEventHandler(async event => {
  const path = getRequestURL(event).pathname
  if (path.startsWith('/api/') || path.startsWith('/_nuxt/') || path.startsWith('/site-preview/') || path.startsWith('/agenda-manage/')) return
  const hostname = requestHostname(event)
  if (!hostname || reservedHostnames().has(hostname) || hostname.endsWith('.vercel.app')) return
  if (siteRequestHasTraversal(event.node.req.url ?? '')) {
    if (await isActiveSiteDomain(hostname)) return sitePublicNotFound(event)
    return
  }
  let normalizedPath: string | undefined
  try { normalizedPath = normalizeSitePath(path) } catch { normalizedPath = undefined }
  const page = normalizedPath ? await resolvePublishedDomain(hostname, normalizedPath) : null
  if (page) {
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    setResponseHeader(event, 'cache-control', 'public, s-maxage=60, stale-while-revalidate=300')
    const agenda = await siteAgendaPresentation(event, page)
    if (agenda) setResponseHeader(event, 'cache-control', 'no-store')
    return renderPublicSiteDocument(page, agenda, protectSiteAgendaDocument(event, page))
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
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página no encontrada</title></head><body style="font-family:Inter,system-ui,sans-serif;color:#33475b;padding:64px"><h1>Página no encontrada</h1><p>La ruta solicitada no está publicada.</p></body></html>'
  }
})
