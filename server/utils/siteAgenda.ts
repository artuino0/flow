import { getHeader, getRequestURL, setResponseHeader, type H3Event } from 'h3'
import { randomBytes } from 'node:crypto'
import { analyzeAgendaMarkers } from '~/utils/agendaMarkers'
import type { PublicSitePage } from './siteDomains'
import { publicAgendaPresentation, resolveAgendaContext } from './agendaPublic'

export function protectSiteAgendaDocument(event: H3Event, page: PublicSitePage) {
  if (!analyzeAgendaMarkers(page.html).length) return undefined
  const nonce = randomBytes(24).toString('base64')
  setResponseHeader(event, 'Content-Security-Policy', `script-src 'nonce-${nonce}'; script-src-attr 'none'; object-src 'none'; base-uri 'self'`)
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return nonce
}

export async function siteAgendaPresentation(event: H3Event, page: PublicSitePage) {
  if (!analyzeAgendaMarkers(page.html).length) return undefined
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
