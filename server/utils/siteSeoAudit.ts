import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { sites, sitePages, sitePageVersions, siteDomains, siteAssets } from '~/server/db/schema'
import { auditSiteSeo, type SeoAuditPage } from '~/utils/siteSeoAudit'
import { editableSiteSeo } from '~/utils/siteSeo'
export async function getSiteSeoAudit(tenantId: string, siteId: string) {
  return withTenant(tenantId, async tx => {
    const [site] = await tx.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId))).limit(1)
    if (!site) return null
    const rows = await tx.select({ page: sitePages, version: sitePageVersions }).from(sitePages)
      .leftJoin(sitePageVersions, and(eq(sitePageVersions.id, sitePages.draftVersionId), eq(sitePageVersions.tenantId, tenantId)))
      .where(and(eq(sitePages.siteId, siteId), eq(sitePages.tenantId, tenantId))).limit(1001)
    const domains = await tx.select().from(siteDomains).where(and(eq(siteDomains.siteId, siteId), eq(siteDomains.tenantId, tenantId)))
    const assets = await tx.select({ id: siteAssets.id, fileName: siteAssets.fileName, sizeBytes: siteAssets.sizeBytes }).from(siteAssets).where(and(eq(siteAssets.siteId, siteId), eq(siteAssets.tenantId, tenantId))).limit(5001)
    const main = domains.find(domain => domain.isPrimary && domain.status === 'active')
    const pages: SeoAuditPage[] = rows.map(({ page, version }) => ({ id: page.id, title: page.title, path: page.path, status: page.status, html: version?.html ?? '', css: version?.css ?? '', seo: editableSiteSeo(version?.seo ?? page.seo) }))
    const context = { locale: site.locale, hostname: main?.hostname ?? domains.find(domain => domain.status === 'active')?.hostname, domainActive: domains.some(domain => domain.status === 'active'), primary: !!main, googleVerified: !!(site.settings as { searchVerification?: { google?: string } }).searchVerification?.google, rootPath: rows.find(row => row.page.id === main?.rootPageId)?.page.path ?? '/', pages, assets }
    return { pages: pages.map(page => ({ id: page.id, title: page.title, path: page.path, ...auditSiteSeo(page, context) })) }
  })
}
