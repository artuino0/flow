import { getHeader, getRequestURL, setResponseHeader, type H3Event } from 'h3'
import { analyzeAgendaMarkers } from '~/utils/agendaMarkers'
import { hasSiteAuthorScripts } from '~/utils/siteAuthorScripts'
import type { PublicSitePage } from './siteDomains'
import { agendaFlowOrigin, publicAgendaPresentation, resolveAgendaContext } from './agendaPublic'

export function protectSiteAgendaDocument(event: H3Event, page: PublicSitePage) {
  if (!analyzeAgendaMarkers(page.html).length) return undefined
  // La página pertenece al autor: Agenda no limita sus scripts ni enlaces.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return undefined
}

export function sandboxSitePreview(event: H3Event, page: PublicSitePage) {
  const url = getRequestURL(event)
  if (process.env.NODE_ENV !== 'production' || !url.pathname.startsWith('/site-preview/') || url.origin !== agendaFlowOrigin() || !hasSiteAuthorScripts(page.html)) return false
  setResponseHeader(event, 'Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-modals')
  return true
}

export async function siteAgendaPresentation(event: H3Event, page: PublicSitePage, preview = false) {
  if (!analyzeAgendaMarkers(page.html).length) return undefined
  if (preview) return { enabled: true, services: [{ id: 'demo', name: 'Servicio de ejemplo' }], people: [{ id: 'demo-person', name: 'Persona de ejemplo' }],
    runtime: { site: page.siteId, page: page.pageId, locale: page.siteLocale, accent: 'rgb(0 110 132)', timezone: 'UTC', preview: true } }
  const url = getRequestURL(event)
  const host = getHeader(event, 'host') ?? url.host
  try {
    const context = await resolveAgendaContext(page.siteId, page.pageId, { origin: `${url.protocol}//${host}`, host, ip: '', userAgent: '' })
    return await publicAgendaPresentation(context, page.siteLocale)
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return undefined
    throw error
  }
}
