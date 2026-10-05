import { sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { siteDomains, sites } from '~/server/db/schema'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { siteRelativeAssetName } from '~/utils/siteAssetPath'
import type { PublicSitePage } from './siteDomains'
import type { PublicSeoContext } from './siteSeoDocument'

export interface SiteSeoDomainContext { site_id: string; status: string; site_status: string; primary_host: string | null; root_path: string; verification: unknown }
export async function getSiteSeoDomainContext(hostname: string) {
  const rows = await db.execute(sql`select * from public_site_seo_context(${hostname})`) as unknown as SiteSeoDomainContext[]
  const context = rows[0]
  // No se refleja una autoridad arbitraria aunque los datos antiguos estén mal formados.
  if (context?.primary_host && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(context.primary_host)) return null
  return context ?? null
}
export async function getSiteSitemapPages(hostname: string) {
  return await db.execute(sql`select * from public_site_sitemap(${hostname})`) as unknown as Array<{ path: string; seo: Record<string, unknown>; lastmod: string; html: string }>
}
export async function publicSiteSeoContext(page: PublicSitePage, domain: SiteSeoDomainContext): Promise<PublicSeoContext> {
  const result: PublicSeoContext = { origin: `https://${domain.primary_host}`, rootPath: domain.root_path, verification: domain.verification }
  const id = page.seo.ogImageAssetId
  if (typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    const rows = await db.execute(sql`select * from public_site_seo_image(${domain.primary_host!},${id}::uuid)`) as unknown as Array<{ file_name: string }>
    const name = rows[0]?.file_name
    if (name && siteRelativeAssetName('/assets/' + encodeURIComponent(name))) {
      result.imagePath = '/assets/' + encodeURIComponent(name)
      result.imageAlt = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    }
  }
  return result
}
export async function setPrimarySiteDomain(tenantId: string, domainId: string) {
  return withTenant(tenantId, async tx => {
    const [domain] = await tx.select().from(siteDomains).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).limit(1)
    if (!domain) return null
    if (domain.status !== 'active') throw createError({ statusCode: 422, statusMessage: 'Verifica el dominio antes de marcarlo como principal' })
    // La fila del sitio serializa dos selecciones concurrentes del principal.
    await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.id, domain.siteId), eq(sites.tenantId, tenantId))).for('update')
    await tx.update(siteDomains).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(siteDomains.siteId, domain.siteId), eq(siteDomains.tenantId, tenantId)))
    const [updated] = await tx.update(siteDomains).set({ isPrimary: true, updatedAt: new Date() }).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).returning()
    return updated
  })
}
