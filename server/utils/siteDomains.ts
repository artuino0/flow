import { promises as dns } from 'node:dns'
import { domainToASCII } from 'node:url'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { siteDomains, sitePages, sites } from '~/server/db/schema'

export type DomainRecordType = 'apex' | 'subdomain'
export interface PublicSitePage {
  siteId: string
  pageId: string
  siteName: string
  siteLocale: string
  pageTitle: string
  pagePath: string
  seo: Record<string, unknown>
  html: string
  css: string
}

export class DuplicateDomainError extends Error {}

export function normalizeHostname(value: string) {
  const withoutProtocol = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (withoutProtocol.includes('/') || withoutProtocol.includes(':')) throw createError({ statusCode: 422, statusMessage: 'Escribe únicamente el dominio, sin protocolo, ruta ni puerto' })
  const hostname = domainToASCII(withoutProtocol).replace(/\.$/, '')
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    throw createError({ statusCode: 422, statusMessage: 'El dominio no tiene un formato válido' })
  }
  return hostname
}

export function domainDnsInstructions(hostname: string, recordType: DomainRecordType) {
  const apexIp = process.env.SITES_APEX_IP?.trim() || '76.76.21.21'
  const cnameTarget = process.env.SITES_CNAME_TARGET?.trim() || 'cname.vercel-dns-0.com'
  return recordType === 'apex'
    ? { type: 'A' as const, name: '@', value: apexIp }
    : { type: 'CNAME' as const, name: hostname.split('.')[0], value: cnameTarget }
}

function vercelConfig() {
  const token = process.env.VERCEL_TOKEN?.trim()
  const project = process.env.VERCEL_PROJECT_ID?.trim()
  const team = process.env.VERCEL_TEAM_ID?.trim()
  return token && project ? { token, project, team } : null
}

async function vercelRequest(path: string, init: RequestInit = {}) {
  const config = vercelConfig()
  if (!config) return null
  const separator = path.includes('?') ? '&' : '?'
  const url = `https://api.vercel.com${path}${config.team ? `${separator}teamId=${encodeURIComponent(config.team)}` : ''}`
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json', ...(init.headers ?? {}) }
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok && response.status !== 409) throw new Error(typeof body.error === 'object' ? JSON.stringify(body.error) : `Vercel respondió ${response.status}`)
  return body
}

async function addDomainToVercel(hostname: string) {
  const config = vercelConfig()
  if (!config) return { configured: false, response: null }
  const response = await vercelRequest(`/v10/projects/${encodeURIComponent(config.project)}/domains`, {
    method: 'POST', body: JSON.stringify({ name: hostname })
  })
  return { configured: true, response }
}

async function verifyDomainWithVercel(hostname: string) {
  const config = vercelConfig()
  if (!config) return null
  const response = await vercelRequest(`/v9/projects/${encodeURIComponent(config.project)}/domains/${encodeURIComponent(hostname)}/verify`, { method: 'POST' })
  return response?.verified === true
}

async function verifyDns(hostname: string, recordType: DomainRecordType) {
  const expected = domainDnsInstructions(hostname, recordType)
  try {
    if (recordType === 'apex') return (await dns.resolve4(hostname)).includes(expected.value)
    const values = await dns.resolveCname(hostname)
    return values.some(value => value.toLowerCase().replace(/\.$/, '') === expected.value.toLowerCase().replace(/\.$/, '') || /\.vercel-dns(?:-\d+)?\.com$/i.test(value))
  } catch {
    return false
  }
}

export async function listSiteDomains(tenantId: string, siteId?: string) {
  return withTenant(tenantId, async tx => {
    const rows = await tx.select({
      id: siteDomains.id, siteId: siteDomains.siteId, siteName: sites.name, hostname: siteDomains.hostname,
      status: siteDomains.status, isPrimary: siteDomains.isPrimary, rootPageId: siteDomains.rootPageId,
      rootPageTitle: sitePages.title, provider: siteDomains.provider, providerData: siteDomains.providerData,
      lastCheckedAt: siteDomains.lastCheckedAt, createdAt: siteDomains.createdAt
    }).from(siteDomains)
      .innerJoin(sites, eq(sites.id, siteDomains.siteId))
      .leftJoin(sitePages, eq(sitePages.id, siteDomains.rootPageId))
      .where(siteId ? and(eq(siteDomains.tenantId, tenantId), eq(siteDomains.siteId, siteId)) : eq(siteDomains.tenantId, tenantId))
      .orderBy(asc(siteDomains.hostname))
    return rows.map(row => {
      const providerData = row.providerData as { recordType?: DomainRecordType; providerError?: string } | null
      const recordType = providerData?.recordType === 'apex' ? 'apex' : 'subdomain'
      return { ...row, recordType, dns: domainDnsInstructions(row.hostname, recordType), providerConfigured: Boolean(vercelConfig()) }
    })
  })
}

export async function createSiteDomain(tenantId: string, userId: string, input: { siteId: string; hostname: string; rootPageId?: string | null; recordType: DomainRecordType }) {
  const hostname = normalizeHostname(input.hostname)
  const binding = await withTenant(tenantId, async tx => {
    const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId))).limit(1)
    if (!site) return null
    if (input.rootPageId) {
      const [page] = await tx.select({ id: sitePages.id }).from(sitePages).where(and(eq(sitePages.id, input.rootPageId), eq(sitePages.siteId, input.siteId), eq(sitePages.tenantId, tenantId))).limit(1)
      if (!page) throw createError({ statusCode: 422, statusMessage: 'La página de inicio no pertenece al sitio seleccionado' })
    }
    const [existing] = await tx.select({ id: siteDomains.id }).from(siteDomains).where(eq(siteDomains.hostname, hostname)).limit(1)
    if (existing) throw new DuplicateDomainError('Este dominio ya está conectado a Flow')
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(siteDomains).where(and(eq(siteDomains.siteId, input.siteId), eq(siteDomains.tenantId, tenantId)))
    return { isPrimary: count === 0 }
  })
  if (!binding) return null

  let providerData: Record<string, unknown> = { recordType: input.recordType }
  try {
    const registration = await addDomainToVercel(hostname)
    providerData = { ...providerData, vercelConfigured: registration.configured, vercel: registration.response }
  } catch (error) {
    providerData = { ...providerData, vercelConfigured: true, providerError: error instanceof Error ? error.message : 'No se pudo registrar el dominio en Vercel' }
  }
  return withTenant(tenantId, async tx => {
    try {
      const [domain] = await tx.insert(siteDomains).values({
        tenantId, siteId: input.siteId, hostname, rootPageId: input.rootPageId || null,
        isPrimary: binding.isPrimary, providerData, createdBy: userId
      }).returning()
      return domain
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code
      if (code === '23505') throw new DuplicateDomainError('Este dominio ya está conectado a Flow')
      throw error
    }
  })
}
export async function verifySiteDomain(tenantId: string, domainId: string) {
  const current = await withTenant(tenantId, async tx => {
    const [row] = await tx.select().from(siteDomains).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).limit(1)
    return row ?? null
  })
  if (!current) return null
  const providerData = current.providerData as { recordType?: DomainRecordType } | null
  const recordType = providerData?.recordType === 'apex' ? 'apex' : 'subdomain'
  let verified = false
  let providerError: string | undefined
  try {
    const vercelResult = await verifyDomainWithVercel(current.hostname)
    verified = vercelResult ?? await verifyDns(current.hostname, recordType)
  } catch (error) {
    providerError = error instanceof Error ? error.message : 'No se pudo verificar el dominio'
  }
  return withTenant(tenantId, async tx => {
    const [updated] = await tx.update(siteDomains).set({
      status: verified ? 'active' : 'pending', lastCheckedAt: new Date(), updatedAt: new Date(),
      providerData: { ...(current.providerData as Record<string, unknown>), ...(providerError ? { providerError } : {}), verified }
    }).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).returning()
    return updated ?? null
  })
}

export async function deleteSiteDomain(tenantId: string, domainId: string) {
  return withTenant(tenantId, async tx => {
    const deleted = await tx.delete(siteDomains).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).returning({ id: siteDomains.id })
    return deleted.length > 0
  })
}

function mapPublicRow(row: Record<string, unknown> | undefined): PublicSitePage | null {
  if (!row) return null
  return {
    siteId: String(row.site_id), pageId: String(row.page_id), siteName: String(row.site_name),
    siteLocale: String(row.site_locale), pageTitle: String(row.page_title), pagePath: String(row.page_path),
    seo: (row.seo ?? {}) as Record<string, unknown>, html: String(row.html ?? ''), css: String(row.css ?? '')
  }
}

export async function resolvePublishedDomain(hostname: string, path: string) {
  const rows = await db.execute(sql`select * from resolve_published_site_domain(${hostname}, ${path})`) as unknown as Record<string, unknown>[]
  return mapPublicRow(rows[0])
}

export async function resolvePublishedPreview(siteId: string, path: string) {
  const rows = await db.execute(sql`select * from resolve_published_site_preview(${siteId}::uuid, ${path})`) as unknown as Record<string, unknown>[]
  return mapPublicRow(rows[0])
}

export async function isActiveSiteDomain(hostname: string) {
  const rows = await db.execute(sql`select is_active_site_domain(${hostname}) as active`) as unknown as { active: boolean }[]
  return Boolean(rows[0]?.active)
}

function escapeDocumentText(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
}

export function renderPublicSiteDocument(page: PublicSitePage) {
  const title = escapeDocumentText(String(page.seo?.title || page.pageTitle))
  const description = escapeDocumentText(String(page.seo?.description || ''))
  const style = `<style data-flow-sites>${page.css}</style>`
  const meta = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ''}${style}`
  if (/<html[\s>]/i.test(page.html)) {
    if (/<\/head>/i.test(page.html)) return page.html.replace(/<\/head>/i, `${meta}</head>`)
    return page.html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`)
  }
  return `<!doctype html><html lang="${escapeDocumentText(page.siteLocale)}"><head>${meta}</head><body>${page.html}</body></html>`
}


