import { promises as dns } from 'node:dns'
import { domainToASCII } from 'node:url'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getDomain } from 'tldts'
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

interface DnsInstruction {
  type: 'A' | 'CNAME' | 'TXT'
  name: string
  value: string
  purpose: 'routing' | 'ownership'
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
  const routing = domainDnsInstructions(row.hostname, recordType)
  return {
    ...row,
    recordType,
    dns: routing,
    dnsRecords: [...ownershipInstructions(row.hostname, providerData), routing],
    providerConfigured: Boolean(vercelConfig()),
    ownershipVerified: (providerData.vercel as VercelDomainResponse | undefined)?.verified !== false,
    dnsVerified: providerData.dnsVerified === true
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

  let registration: VercelDomainResponse
  try {
    registration = await addDomainToVercel(hostname)
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 403) {
      throw createError({
        statusCode: 502,
        statusMessage: 'La credencial de Flow no tiene permisos para administrar dominios en el proyecto de Vercel'
      })
    }
    if (error instanceof VercelApiError && error.status === 409) {
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

  const dnsVerified = await verifyDns(hostname, recordType)
  const active = registration.verified !== false && dnsVerified
  const providerData: Record<string, unknown> = {
    recordType,
    vercelConfigured: true,
    vercel: registration,
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
  let vercel: VercelDomainResponse | undefined
  let providerError: string | undefined
  try {
    vercel = await addDomainToVercel(current.hostname)
    verified = vercel.verified === true
    if (!verified) {
      try {
        vercel = await verifyDomainWithVercel(current.hostname)
        verified = vercel.verified === true
      } catch {
        // Keep the verification challenge so the tenant can copy its TXT record.
      }
    }
    dnsVerified = await verifyDns(current.hostname, recordType)
  } catch (error) {
    providerError = error instanceof Error ? error.message : 'No se pudo verificar el dominio'
  }

  return withTenant(tenantId, async tx => {
    const previousProviderData = (current.providerData ?? {}) as Record<string, unknown>
    const nextProviderData: Record<string, unknown> = {
      ...previousProviderData,
      recordType,
      ...(vercel ? { vercel } : {}),
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
  await removeDomainFromVercel(current.hostname)
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

export function renderPublicSiteDocument(page: PublicSitePage) {
  const title = escapeDocumentText(String(page.seo?.title || page.pageTitle))
  const description = escapeDocumentText(String(page.seo?.description || ''))
  const style = `<style data-flow-sites>${page.css}</style>`
  const meta = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ''}${style}`
  const runtime = publicFormsRuntime(page)
  if (/<html[\s>]/i.test(page.html)) {
    let document = /<\/head>/i.test(page.html)
      ? page.html.replace(/<\/head>/i, `${meta}</head>`)
      : page.html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`)
    document = /<\/body>/i.test(document) ? document.replace(/<\/body>/i, `${runtime}</body>`) : document + runtime
    return document
  }
  return `<!doctype html><html lang="${escapeDocumentText(page.siteLocale)}"><head>${meta}</head><body>${page.html}${runtime}</body></html>`
}
