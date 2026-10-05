import { setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import { getRelativeSiteAsset, MAX_SITE_ASSET_BYTES, readSiteAsset } from './managedStorage'
import { StoredObjectNotFoundError } from './objectStorage'
import type { PublicSitePage } from './siteDomains'

export function sitePublicNotFound(event: H3Event) {
  setResponseStatus(event, 404)
  setResponseHeader(event, 'X-Robots-Tag', 'noindex')
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return 'Archivo o página no encontrados.'
}

export async function sendRelativeSiteAsset(event: H3Event, page: PublicSitePage | null, rawPath: string) {
  const asset = page ? await getRelativeSiteAsset(page, rawPath) : null
  if (!asset) return sitePublicNotFound(event)
  let body: Buffer
  try { body = await readSiteAsset(asset.storageKey) } catch (error) {
    if (error instanceof StoredObjectNotFoundError) return sitePublicNotFound(event)
    throw error
  }
  if (body.length > MAX_SITE_ASSET_BYTES) return sitePublicNotFound(event)
  setResponseHeader(event, 'Content-Type', asset.mimeType)
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
  // Solo archivos ya públicos; fuentes/módulos también cargan en sandbox.
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  return body
}
