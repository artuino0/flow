import { promises as dns } from 'node:dns'
import { domainToASCII } from 'node:url'
import { createError } from 'h3'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getDomain } from 'tldts'
import { db, withTenant } from '~/server/db'
import { siteDomains, sitePages, sites } from '~/server/db/schema'
import { transformAgendaMarkers, type AgendaMarkerConfig } from '~/utils/agendaMarkers'
import { publicAgendaRuntime, type AgendaRuntimeConfig } from '~/utils/publicAgendaRuntime'
import { cloudflarePresentation, cloudflarePublicData, cloudflareSiteDomainProvider } from './cloudflareSiteDomains'
import { isReservedSiteHostname } from './siteDomainHostnames'

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

export interface DnsInstruction {
  type: 'A' | 'CNAME' | 'TXT'
  name: string
  value: string
  purpose: 'routing' | 'ownership'
}

export type SiteDomainProviderName = 'vercel' | 'railway' | 'cloudflare'
export interface SiteDomainProvider {
  name: SiteDomainProviderName
  configured: boolean
  register(hostname: string): Promise<Record<string, unknown>>
  status(hostname: string, providerData?: Record<string, unknown>): Promise<Record<string, unknown>>
  remove(hostname: string, providerData?: Record<string, unknown>): Promise<void>
  dns(hostname: string, providerData?: Record<string, unknown>): DnsInstruction[]
  verified(data: Record<string, unknown>): boolean
}

interface VercelVerificationChallenge {
  type?: string
  domain?: string
  value?: string
}

interface VercelDomainResponse extends Record<string, unknown> {
  verified?: boolean
  verification?: VercelVerificationChallenge[]
}

interface DomainPresentationRow {
  hostname: string
  providerData?: unknown
  [key: string]: unknown
}

export class DuplicateDomainError extends Error {}

class VercelApiError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message)
  }
}

export function normalizeHostname(value: string) {
  const withoutProtocol = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (withoutProtocol.includes('/') || withoutProtocol.includes(':')) {
    throw createError({ statusCode: 422, statusMessage: 'Escribe únicamente el dominio, sin protocolo, ruta ni puerto' })
  }
  const hostname = domainToASCII(withoutProtocol).replace(/\.$/, '')
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    throw createError({ statusCode: 422, statusMessage: 'El dominio no tiene un formato válido' })
  }
  return hostname
}

export function inferDomainRecordType(hostname: string): DomainRecordType {
  const registrableDomain = getDomain(hostname, { allowPrivateDomains: true })
  return registrableDomain && hostname === registrableDomain ? 'apex' : 'subdomain'
}

function relativeDnsName(hostname: string) {
  const registrableDomain = getDomain(hostname, { allowPrivateDomains: true })
  if (!registrableDomain || hostname === registrableDomain) return '@'
  return hostname.slice(0, -(registrableDomain.length + 1))
}

export function domainDnsInstructions(hostname: string, recordType = inferDomainRecordType(hostname)): DnsInstruction {
  const apexIp = process.env.SITES_APEX_IP?.trim() || '76.76.21.21'
  const cnameTarget = process.env.SITES_CNAME_TARGET?.trim() || 'cname.vercel-dns-0.com'
  return recordType === 'apex'
    ? { type: 'A', name: '@', value: apexIp, purpose: 'routing' }
    : { type: 'CNAME', name: relativeDnsName(hostname), value: cnameTarget, purpose: 'routing' }
}

export function providerName(): SiteDomainProviderName {
  const requested = process.env.SITE_DOMAIN_PROVIDER?.trim().toLowerCase()
  if (requested && requested !== 'vercel' && requested !== 'railway' && requested !== 'cloudflare') {
    throw createError({ statusCode: 503, statusMessage: 'SITE_DOMAIN_PROVIDER debe ser vercel o railway o cloudflare' })
  }
  if (requested) return requested as SiteDomainProviderName
  if (process.env.VERCEL_TOKEN?.trim()) return 'vercel'
  if (process.env.RAILWAY_API_TOKEN?.trim()) return 'railway'
  throw createError({ statusCode: 503, statusMessage: 'Configura SITE_DOMAIN_PROVIDER y las credenciales del proveedor, VERCEL_TOKEN o RAILWAY_API_TOKEN' })
}

function railwayConfig() {
  const token = process.env.RAILWAY_API_TOKEN?.trim()
  const project = process.env.RAILWAY_PROJECT_ID?.trim()
  const service = process.env.RAILWAY_SERVICE_ID?.trim()
  const environment = process.env.RAILWAY_ENVIRONMENT_ID?.trim()
  if (!token || !project || !service || !environment) return null
  return { token, project, service, environment }
}

async function railwayRequest(query: string, variables: Record<string, unknown>) {
  const config = railwayConfig()
  if (!config) throw createError({ statusCode: 503, statusMessage: 'Railway requiere RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID y RAILWAY_ENVIRONMENT_ID' })
  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const body = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; errors?: { message?: string; extensions?: { code?: string } }[] }
  if (body.errors?.some(error => error.extensions?.code === 'GRAPHQL_VALIDATION_FAILED' || error.message?.includes('Cannot query field'))) {
    console.error('[Sites Railway] Error de validación GraphQL:', body.errors.map(error => error.message).filter(Boolean).join('; '))
    throw createError({ statusCode: 502, statusMessage: 'No pudimos registrar el dominio con el proveedor. Inténtalo más tarde o contacta a soporte.' })
  }
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map(error => error.message).filter(Boolean).join('; ') || `Railway respondió ${response.status}`)
  return body.data ?? {}
}

const railwayDomainFields = `id domain edgeId status {
  verified certificateStatus certificateErrorMessage
  verificationToken verificationDnsHost dnsRecords {
    currentValue fqdn hostlabel purpose recordType requiredValue status zone
  }
}`

function railwayDns(hostname: string, data: Record<string, unknown> = {}): DnsInstruction[] {
  const domain = (data.railway ?? data) as Record<string, unknown>
  const status = (domain.status ?? {}) as Record<string, unknown>
  const records = Array.isArray(status.dnsRecords) ? status.dnsRecords as Record<string, unknown>[] : []
  const result = records.flatMap(record => {
    const type = String(record.recordType ?? '').replace('DNS_RECORD_TYPE_', '').toUpperCase()
    const value = String(record.requiredValue ?? '')
    if (!['A', 'CNAME', 'TXT'].includes(type) || !value) return []
    return [{ type: type as DnsInstruction['type'], name: String(record.fqdn ?? record.hostlabel ?? '@'), value, purpose: String(record.purpose ?? '').includes('OWNERSHIP') ? 'ownership' as const : 'routing' as const }]
  })
  const token = typeof status.verificationToken === 'string' ? status.verificationToken : ''
  if (token && !result.some(record => record.purpose === 'ownership')) {
    result.push({ type: 'TXT', name: String(status.verificationDnsHost ?? `_railway-verify.${hostname}`), value: token, purpose: 'ownership' })
  }
  return result
}

function railwayDnsVerified(data: Record<string, unknown>) {
  const domain = (data.railway ?? data) as Record<string, unknown>
  const status = domain.status as Record<string, unknown> | undefined
  const records = Array.isArray(status?.dnsRecords) ? status.dnsRecords as Record<string, unknown>[] : []
  return status?.verified === true || (records.length > 0
    && records.every(record => String(record.status).includes('PROPAGATED') || String(record.status).includes('VALID')))
}

function railwayVerified(data: Record<string, unknown>) {
  const domain = (data.railway ?? data) as Record<string, unknown>
  const status = domain.status as Record<string, unknown> | null | undefined
  const certificate = String(status?.certificateStatus ?? '')
  const dnsVerified = railwayDnsVerified(data)
  return dnsVerified && (!certificate || /(?:ISSUED|VALID|COMPLETE)$/.test(certificate))
}

async function railwayDomain(hostname: string, existing?: Record<string, unknown>) {
  const id = typeof existing?.id === 'string' ? existing.id : ''
  if (id) {
    const data = await railwayRequest(`query customDomain($id: String!) { customDomain(id: $id) { ${railwayDomainFields} } }`, { id })
    return data.customDomain as Record<string, unknown>
  }
  const config = railwayConfig()
  if (!config) throw createError({ statusCode: 503, statusMessage: 'Railway requiere RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID y RAILWAY_ENVIRONMENT_ID' })
  const data = await railwayRequest(`mutation customDomainCreate($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { ${railwayDomainFields} } }`, {
    input: { projectId: config.project, serviceId: config.service, environmentId: config.environment, domain: hostname }
  })
  const result = data.customDomainCreate as Record<string, unknown> | undefined
  if (!result) throw new Error('Railway no devolvió el dominio creado')
  return result
}

export function getSiteDomainProvider(name = providerName()): SiteDomainProvider {
  if (name === 'cloudflare') return cloudflareSiteDomainProvider()
  if (name === 'railway') return {
    name, configured: Boolean(railwayConfig()),
    register: async hostname => await railwayDomain(hostname) as Record<string, unknown>,
    status: async (hostname, data) => await railwayDomain(hostname, (data?.railway as Record<string, unknown>) ?? data),
    remove: async (_hostname, data) => {
      const id = String(((data?.railway ?? data) as Record<string, unknown> | undefined)?.id ?? '')
      if (id) await railwayRequest('mutation customDomainDelete($id: String!) { customDomainDelete(id: $id) }', { id })
    },
    dns: (hostname, data) => railwayDns(hostname, data), verified: railwayVerified
  }
  return {
    name, configured: Boolean(vercelConfig()),
    register: async hostname => await addDomainToVercel(hostname) as Record<string, unknown>,
    status: async hostname => await addDomainToVercel(hostname) as Record<string, unknown>,
    remove: async hostname => await removeDomainFromVercel(hostname),
    dns: (hostname, data) => [...ownershipInstructions(hostname, { vercel: data?.vercel }), domainDnsInstructions(hostname)],
    verified: data => (data.vercel as VercelDomainResponse | undefined)?.verified !== false
  }
}

function vercelConfig() {
  const token = process.env.VERCEL_TOKEN?.trim()
  const project = process.env.VERCEL_PROJECT_ID?.trim()
  const team = process.env.VERCEL_TEAM_ID?.trim()
  return token && project ? { token, project, team } : null
}

function requireVercelConfig() {
  const config = vercelConfig()
  if (!config) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Flow Sites todavía no tiene configurada la conexión administrativa con Vercel'
    })
  }
  return config
}

async function vercelRequest(path: string, init: RequestInit = {}) {
  const config = requireVercelConfig()
  const separator = path.includes('?') ? '&' : '?'
  const url = `https://api.vercel.com${path}${config.team ? `${separator}teamId=${encodeURIComponent(config.team)}` : ''}`
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = body.error as { code?: string; message?: string } | undefined
    throw new VercelApiError(response.status, error?.code, error?.message || `Vercel respondió ${response.status}`)
  }
  return body
}

async function getProjectDomain(hostname: string) {
  const config = requireVercelConfig()
  return await vercelRequest(
    `/v9/projects/${encodeURIComponent(config.project)}/domains/${encodeURIComponent(hostname)}`
  ) as VercelDomainResponse
}

async function addDomainToVercel(hostname: string) {
  const config = requireVercelConfig()
  try {
    return await vercelRequest(`/v10/projects/${encodeURIComponent(config.project)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname })
    }) as VercelDomainResponse
  } catch (error) {
    if (error instanceof VercelApiError && (error.status === 400 || error.status === 409)) {
      try {
        return await getProjectDomain(hostname)
      } catch {
        // Preserve the original registration error when the domain belongs elsewhere.
      }
    }
    throw error
  }
}

async function verifyDomainWithVercel(hostname: string) {
  const config = requireVercelConfig()
  return await vercelRequest(
    `/v9/projects/${encodeURIComponent(config.project)}/domains/${encodeURIComponent(hostname)}/verify`,
    { method: 'POST' }
  ) as VercelDomainResponse
}

async function removeDomainFromVercel(hostname: string) {
  const config = vercelConfig()
  if (!config) return
  try {
    await vercelRequest(
      `/v9/projects/${encodeURIComponent(config.project)}/domains/${encodeURIComponent(hostname)}`,
      { method: 'DELETE' }
    )
  } catch (error) {
    if (!(error instanceof VercelApiError && error.status === 404)) throw error
  }
}

async function verifyDns(hostname: string, recordType: DomainRecordType) {
  const expected = domainDnsInstructions(hostname, recordType)
  try {
    if (recordType === 'apex') return (await dns.resolve4(hostname)).includes(expected.value)
    const values = await dns.resolveCname(hostname)
    return values.some(value => {
      const normalized = value.toLowerCase().replace(/\.$/, '')
      return normalized === expected.value.toLowerCase().replace(/\.$/, '')
        || /\.vercel-dns(?:-\d+)?\.com$/i.test(normalized)
    })
  } catch {
    return false
  }
}

function ownershipInstructions(hostname: string, providerData: Record<string, unknown>): DnsInstruction[] {
  const vercel = providerData.vercel as VercelDomainResponse | undefined
  if (vercel?.verified !== false || !Array.isArray(vercel.verification)) return []
  return vercel.verification.flatMap((challenge) => {
    if (challenge.type?.toUpperCase() !== 'TXT' || !challenge.domain || !challenge.value) return []
    const normalizedDomain = challenge.domain.toLowerCase().replace(/\.$/, '')
    const name = normalizedDomain === hostname
      ? '@'
      : normalizedDomain.endsWith(`.${hostname}`)
        ? normalizedDomain.slice(0, -(hostname.length + 1))
        : normalizedDomain
    return [{
      type: 'TXT' as const,
      name,
      value: challenge.value,
      purpose: 'ownership' as const
    }]
  })
}

function presentDomain(row: DomainPresentationRow) {
  const providerData = (row.providerData ?? {}) as Record<string, unknown>
  const recordType = inferDomainRecordType(row.hostname)
  let provider: SiteDomainProvider | undefined
  try { provider = getSiteDomainProvider((row.provider as SiteDomainProviderName | undefined) ?? providerName()) } catch { /* UI informa que el proveedor no está configurado */ }
  const dnsRecords = provider?.dns(row.hostname, providerData) ?? []
  return {
    ...row,
    recordType,
    dns: dnsRecords.find(record => record.purpose === 'routing') ?? dnsRecords[0] ?? null,
    dnsRecords,
    providerConfigured: provider?.configured ?? false,
    providerName: provider?.name ?? row.provider,
    ownershipVerified: provider?.name === 'railway' ? railwayVerified(providerData) : (providerData.vercel as VercelDomainResponse | undefined)?.verified !== false,
    dnsVerified: providerData.dnsVerified === true,
    ...(provider?.name === 'cloudflare' ? { ...cloudflarePresentation(providerData), providerData: cloudflarePublicData(providerData) } : {})
  }
}

export async function listSiteDomains(tenantId: string, siteId?: string) {
  return withTenant(tenantId, async tx => {
    const rows = await tx.select({
      id: siteDomains.id,
      siteId: siteDomains.siteId,
      siteName: sites.name,
      hostname: siteDomains.hostname,
      status: siteDomains.status,
      isPrimary: siteDomains.isPrimary,
      rootPageId: siteDomains.rootPageId,
      rootPageTitle: sitePages.title,
      provider: siteDomains.provider,
      providerData: siteDomains.providerData,
      lastCheckedAt: siteDomains.lastCheckedAt,
      createdAt: siteDomains.createdAt
    }).from(siteDomains)
      .innerJoin(sites, eq(sites.id, siteDomains.siteId))
      .leftJoin(sitePages, eq(sitePages.id, siteDomains.rootPageId))
      .where(siteId
        ? and(eq(siteDomains.tenantId, tenantId), eq(siteDomains.siteId, siteId))
        : eq(siteDomains.tenantId, tenantId))
      .orderBy(asc(siteDomains.hostname))
    return rows.map(row => presentDomain(row))
  })
}

export async function createSiteDomain(
  tenantId: string,
  userId: string,
  input: { siteId: string; hostname: string; rootPageId?: string | null }
) {
  const hostname = normalizeHostname(input.hostname)
  if (isReservedSiteHostname(hostname)) throw createError({ statusCode: 422, statusMessage: 'Este dominio está reservado para la aplicación o su infraestructura. Usa un dominio distinto para el sitio.' })
  const recordType = inferDomainRecordType(hostname)
  const binding = await withTenant(tenantId, async tx => {
    const [site] = await tx.select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)))
      .limit(1)
    if (!site) return null
    if (input.rootPageId) {
      const [page] = await tx.select({ id: sitePages.id })
        .from(sitePages)
        .where(and(
          eq(sitePages.id, input.rootPageId),
          eq(sitePages.siteId, input.siteId),
          eq(sitePages.tenantId, tenantId)
        ))
        .limit(1)
      if (!page) {
        throw createError({ statusCode: 422, statusMessage: 'La página de inicio no pertenece al sitio seleccionado' })
      }
    }
    const [existing] = await tx.select({ id: siteDomains.id })
      .from(siteDomains)
      .where(eq(siteDomains.hostname, hostname))
      .limit(1)
    if (existing) throw new DuplicateDomainError('Este dominio ya está conectado a Flow')
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(siteDomains)
      .where(and(eq(siteDomains.siteId, input.siteId), eq(siteDomains.tenantId, tenantId)))
    return { isPrimary: count === 0 }
  })
  if (!binding) return null

  const provider = getSiteDomainProvider()
  let registration: Record<string, unknown>
  try {
    registration = await provider.register(hostname)
  } catch (error) {
    if (provider.name === 'vercel' && error instanceof VercelApiError && error.status === 403) {
      throw createError({
        statusCode: 502,
        statusMessage: 'La credencial de Flow no tiene permisos para administrar dominios en el proyecto de Vercel'
      })
    }
    if (provider.name === 'vercel' && error instanceof VercelApiError && error.status === 409) {
      throw createError({
        statusCode: 409,
        statusMessage: 'El dominio ya está asignado a otro proyecto. Vuelve a intentarlo para obtener la verificación TXT o retíralo del proyecto anterior.'
      })
    }
    if ((error as { statusCode?: number }).statusCode) throw error
    throw createError({
      statusCode: 502,
      statusMessage: error instanceof Error ? error.message : 'No se pudo registrar el dominio en Vercel'
    })
  }

  const dnsRecords = provider.dns(hostname, { [provider.name]: registration })
  const dnsVerified = provider.name === 'railway'
    ? railwayVerified(registration)
    : provider.name === 'cloudflare' ? registration.managedByZone === true ? registration.dnsVerified === true : registration.status === 'active'
    : await verifyDns(hostname, recordType)
  const active = provider.verified({ [provider.name]: registration }) && dnsVerified
  const providerData: Record<string, unknown> = {
    recordType,
    [`${provider.name}Configured`]: true,
    [provider.name]: registration,
    dnsRecords,
    dnsVerified
  }

  return withTenant(tenantId, async tx => {
    try {
      const [domain] = await tx.insert(siteDomains).values({
        tenantId,
        siteId: input.siteId,
        hostname,
        rootPageId: input.rootPageId || null,
        isPrimary: binding.isPrimary,
        provider: provider.name,
        status: active ? 'active' : 'pending',
        providerData,
        createdBy: userId
      }).returning()
      return presentDomain({ ...domain, siteName: '', rootPageTitle: null })
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code
        ?? (error as { cause?: { code?: string } }).cause?.code
      if (code === '23505') throw new DuplicateDomainError('Este dominio ya está conectado a Flow')
      throw error
    }
  })
}

export async function verifySiteDomain(tenantId: string, domainId: string) {
  const current = await withTenant(tenantId, async tx => {
    const [row] = await tx.select()
      .from(siteDomains)
      .where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId)))
      .limit(1)
    return row ?? null
  })
  if (!current) return null

  const recordType = inferDomainRecordType(current.hostname)
  let verified = false
  let dnsVerified = false
  let providerResult: Record<string, unknown> | undefined
  const provider = getSiteDomainProvider((current.provider || 'vercel') as SiteDomainProviderName)
  let providerError: string | undefined
  try {
    providerResult = await provider.status(current.hostname, (current.providerData ?? {}) as Record<string, unknown>)
    verified = provider.verified({ [provider.name]: providerResult })
    if (!verified && provider.name === 'vercel') {
      try {
        providerResult = await verifyDomainWithVercel(current.hostname) as Record<string, unknown>
        verified = provider.verified({ [provider.name]: providerResult })
      } catch {
        // Keep the verification challenge so the tenant can copy its TXT record.
      }
    }
    dnsVerified = provider.name === 'railway'
      ? railwayDnsVerified({ railway: providerResult })
      : provider.name === 'cloudflare' ? providerResult.managedByZone === true ? providerResult.dnsVerified === true : providerResult.status === 'active'
      : await verifyDns(current.hostname, recordType)
  } catch (error) {
    providerError = error instanceof Error ? error.message : 'No se pudo verificar el dominio'
  }

  return withTenant(tenantId, async tx => {
    const previousProviderData = (current.providerData ?? {}) as Record<string, unknown>
    const nextProviderData: Record<string, unknown> = {
      ...previousProviderData,
      recordType,
      ...(providerResult ? { [provider.name]: providerResult, dnsRecords: provider.dns(current.hostname, { [provider.name]: providerResult }) } : {}),
      verified,
      dnsVerified
    }
    delete nextProviderData.providerError
    if (providerError) nextProviderData.providerError = providerError

    const [updated] = await tx.update(siteDomains).set({
      status: verified && dnsVerified ? 'active' : 'pending',
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
      providerData: nextProviderData
    }).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).returning()
    return updated ? presentDomain({ ...updated, siteName: '', rootPageTitle: null }) : null
  })
}

export async function deleteSiteDomain(tenantId: string, domainId: string) {
  const current = await withTenant(tenantId, async tx => {
    const [row] = await tx.select({ hostname: siteDomains.hostname })
      .from(siteDomains)
      .where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId)))
      .limit(1)
    return row ?? null
  })
  if (!current) return false
  const domain = await withTenant(tenantId, async tx => {
    const [row] = await tx.select({ provider: siteDomains.provider, providerData: siteDomains.providerData })
      .from(siteDomains).where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId))).limit(1)
    return row ?? null
  })
  if (domain) await getSiteDomainProvider(domain.provider as SiteDomainProviderName).remove(current.hostname, domain.providerData as Record<string, unknown>)
  return withTenant(tenantId, async tx => {
    const deleted = await tx.delete(siteDomains)
      .where(and(eq(siteDomains.id, domainId), eq(siteDomains.tenantId, tenantId)))
      .returning({ id: siteDomains.id })
    return deleted.length > 0
  })
}

function mapPublicRow(row: Record<string, unknown> | undefined): PublicSitePage | null {
  if (!row) return null
  return {
    siteId: String(row.site_id),
    pageId: String(row.page_id),
    siteName: String(row.site_name),
    siteLocale: String(row.site_locale),
    pageTitle: String(row.page_title),
    pagePath: String(row.page_path),
    seo: (row.seo ?? {}) as Record<string, unknown>,
    html: String(row.html ?? ''),
    css: String(row.css ?? '')
  }
}

export async function resolvePublishedDomain(hostname: string, path: string) {
  const rows = await db.execute(
    sql`select * from resolve_published_site_domain(${hostname}, ${path})`
  ) as unknown as Record<string, unknown>[]
  return mapPublicRow(rows[0])
}

export async function resolvePublishedPreview(siteId: string, path: string) {
  const rows = await db.execute(
    sql`select * from resolve_published_site_preview(${siteId}::uuid, ${path})`
  ) as unknown as Record<string, unknown>[]
  return mapPublicRow(rows[0])
}

export async function isActiveSiteDomain(hostname: string) {
  const rows = await db.execute(
    sql`select is_active_site_domain(${hostname}) as active`
  ) as unknown as { active: boolean }[]
  return Boolean(rows[0]?.active)
}

function escapeDocumentText(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]!))
}

function publicFormsRuntime(page: PublicSitePage) {
  const config = JSON.stringify({ siteId: page.siteId, pageId: page.pageId }).replace(/</g, '\\u003c')
  return `<script data-flow-sites-runtime>(function(){var cfg=${config};function nodes(form,name){var root=form.closest('[data-flow-form-container]')||form.parentElement||document;return root.querySelectorAll('[data-flow-form-'+name+']')}function state(form,name,message){form.dataset.flowState=name;['success','error','validation'].forEach(function(key){nodes(form,key).forEach(function(node){node.hidden=key!==name})});var output=form.querySelector('[data-flow-form-message]');if(!output){output=document.createElement('p');output.setAttribute('data-flow-form-message','');output.setAttribute('role','status');form.appendChild(output)}output.textContent=message||'';output.hidden=!message}function payload(form){var result={};new FormData(form).forEach(function(value,key){if(value instanceof File)return;var current=result[key];if(current===undefined)result[key]=value;else if(Array.isArray(current))current.push(value);else result[key]=[current,value]});return result}function boot(){document.querySelectorAll('form[data-flow-form]').forEach(function(form){if(form.dataset.flowBound==='true')return;form.dataset.flowBound='true';state(form,'idle','');form.addEventListener('submit',async function(event){event.preventDefault();var submittedPayload=payload(form);if(!form.checkValidity()){form.reportValidity();state(form,'validation','Revisa los campos marcados.');return}var buttons=form.querySelectorAll('[type=submit]');buttons.forEach(function(button){button.disabled=true});form.setAttribute('aria-busy','true');state(form,'submitting','');try{var response=await fetch('/api/sites/forms/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({siteId:cfg.siteId,pageId:cfg.pageId,formKey:form.dataset.flowForm,payload:submittedPayload,href:location.href,referrer:document.referrer})});var body=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(body.statusMessage||body.message||'No se pudo enviar el formulario.');form.reset();state(form,'success','');if(form.hasAttribute('data-flow-hide-on-success'))form.hidden=true;form.dispatchEvent(new CustomEvent('flow:form-success',{bubbles:true,detail:body}))}catch(error){state(form,'error',error instanceof Error?error.message:'No se pudo enviar el formulario.');form.dispatchEvent(new CustomEvent('flow:form-error',{bubbles:true,detail:{error:error}}))}finally{buttons.forEach(function(button){button.disabled=false});form.removeAttribute('aria-busy')}},true)})}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()})();</script>`
}

export function renderPublicSiteDocument(page: PublicSitePage, agenda?: AgendaMarkerConfig & { runtime: AgendaRuntimeConfig }, nonce?: string) {
  const transformed = transformAgendaMarkers(page.html, agenda ?? { enabled: false, services: [], people: [] })
  const agendaScript = agenda?.enabled && transformed.active ? publicAgendaRuntime(agenda.runtime) : ''
  if (transformed.markers.length) page = { ...page, html: transformed.html }
  const title = escapeDocumentText(String(page.seo?.title || page.pageTitle))
  const description = escapeDocumentText(String(page.seo?.description || ''))
  const style = `<meta name="color-scheme" content="light"><style data-flow-sites>${page.css}</style><style data-flow-theme>:root{color-scheme:light!important}</style>`
  const meta = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ''}${style}`
  const runtime = (publicFormsRuntime(page) + agendaScript).replace(/<script data-flow-(sites|agenda)-runtime>/g, match => nonce ? match.replace('>', ` nonce="${escapeDocumentText(nonce)}">`) : match)
  if (/<html[\s>]/i.test(page.html)) {
    let document = /<\/head>/i.test(page.html)
      ? page.html.replace(/<\/head>/i, `${meta}</head>`)
      : page.html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`)
    document = /<\/body>/i.test(document) ? document.replace(/<\/body>/i, `${runtime}</body>`) : document + runtime
    return document
  }
  return `<!doctype html><html lang="${escapeDocumentText(page.siteLocale)}"><head>${meta}</head><body>${page.html}${runtime}</body></html>`
}
