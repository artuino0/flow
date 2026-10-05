import { renderSiteRobots } from './siteSeoDocument'
import { sendRedirect, setResponseHeader, type H3Event } from 'h3'
import { effectiveRequestURL } from './effectiveHost'
import { siteRequestHasTraversal } from '~/utils/siteAssetPath'
import { normalizeSitePath } from '~/server/utils/sites'
import { renderPublicSiteDocument, resolvePublishedPreview } from '~/server/utils/siteDomains'
import { protectSiteAgendaDocument, sandboxSitePreview, siteAgendaPresentation } from '~/server/utils/siteAgenda'
import { sendRelativeSiteAsset, sitePublicNotFound } from './publicSiteAssets'
import { sandboxSiteFormsDocument } from './sitePreviewForms'
export async function sendSitePreview(event: H3Event, siteId: string, rawPath = '/') {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(siteId) || siteRequestHasTraversal(event.node.req.url ?? '')) return sitePublicNotFound(event)
  const url = effectiveRequestURL(event)
  if (url.pathname === `/site-preview/${siteId}`) return sendRedirect(event, `${url.pathname}/${url.search}`, 308)
  if (rawPath === '/robots.txt') { setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8'); setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow'); return renderSiteRobots() }
  let path: string | undefined
  try { path = normalizeSitePath(rawPath) } catch { path = undefined }
  const page = path ? await resolvePublishedPreview(siteId, path) : null
  if (!page) return sendRelativeSiteAsset(event, await resolvePublishedPreview(siteId, '/'), rawPath)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow')
  const sandboxed = sandboxSitePreview(event, page)
  const agenda = await siteAgendaPresentation(event, page, sandboxed)
  if (agenda) setResponseHeader(event, 'cache-control', 'no-store')
  const document = renderPublicSiteDocument(page, agenda, protectSiteAgendaDocument(event, page), { origin: '', rootPath: '/', preview: true })
  return sandboxed ? sandboxSiteFormsDocument(document) : document
}
