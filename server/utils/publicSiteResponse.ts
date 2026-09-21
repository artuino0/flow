import type { H3Event } from 'h3'
import { normalizeSitePath } from '~/server/utils/sites'
import { renderPublicSiteDocument, resolvePublishedPreview } from '~/server/utils/siteDomains'
export async function sendSitePreview(event: H3Event, siteId: string, rawPath = '/') {
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
  let path = '/'
  try { path = normalizeSitePath(rawPath) } catch { throw createError({ statusCode: 404, statusMessage: 'Página no encontrada' }) }
  const page = await resolvePublishedPreview(siteId, path)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Publica esta página antes de abrir la vista pública' })
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow')
  return renderPublicSiteDocument(page)
}