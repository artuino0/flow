import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createEvent, createError } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { JSDOM } from 'jsdom'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { captureEdgeHost } from '../../server/utils/effectiveHost'
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db')
let sites: typeof import('../../server/utils/sites'), domains: typeof import('../../server/utils/siteDomains'), seo: typeof import('../../server/utils/siteSeoPublic'), audit: typeof import('../../server/utils/siteSeoAudit')
let handler: typeof import('../../server/middleware/site-domain').default, preview: typeof import('../../server/utils/publicSiteResponse').sendSitePreview
const tenant = randomUUID(), otherTenant = randomUUID()
let siteId: string, pageId: string, userId: string, roleId: string, mainId: string, otherId: string, imageId: string
function request(path: string, host = 'principal189.test') {
  const req = new IncomingMessage(new Socket()); req.url = path; req.headers.host = host
  return createEvent(req, new ServerResponse(req))
}
const actor = <T>(fn: () => Promise<T>) => withRecordActor({ userId, roleId }, fn)
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = 'http://localhost:3000'
  vi.stubGlobal('createError', createError)
  connection = await import('../../server/db'); sites = await import('../../server/utils/sites'); domains = await import('../../server/utils/siteDomains'); seo = await import('../../server/utils/siteSeoPublic'); audit = await import('../../server/utils/siteSeoAudit')
  handler = (await import('../../server/middleware/site-domain')).default; preview = (await import('../../server/utils/publicSiteResponse')).sendSitePreview
  await admin`insert into tenants(id,name,slug) values (${tenant},'SEO 189',${'seo-' + tenant}),(${otherTenant},'Otro',${'seo-' + otherTenant})`
  const [role] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`; roleId = role!.id
  const [person] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x','SEO admin') returning id`
  const [user] = await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person!.id},${roleId}) returning id`; userId = user!.id
  siteId = (await actor(() => sites.createSite(tenant, userId, { name: 'Sitio SEO', slug: 'seo189' })))!.id
  const [page] = await admin`select id from site_pages where site_id=${siteId}`; pageId = page!.id
  await actor(() => sites.saveSitePageDraft(tenant, userId, siteId, pageId, { title: 'Inicio', path: '/', html: '<h1>Inicio</h1>', css: '', seo: { title: 'Publicado', description: 'Descripción publicada' } }))
  await actor(() => sites.publishSitePage(tenant, userId, siteId, pageId))
  const [main] = await admin`insert into site_domains(tenant_id,site_id,hostname,status,is_primary) values (${tenant},${siteId},'principal189.test','active',true) returning id`; mainId = main!.id
  const [other] = await admin`insert into site_domains(tenant_id,site_id,hostname,status) values (${tenant},${siteId},'alterno189.test','active') returning id`; otherId = other!.id
  await admin`insert into site_domains(tenant_id,site_id,hostname,status) values (${tenant},${siteId},'pendiente189.test','pending')`
  imageId = randomUUID()
  await admin`insert into site_assets(id,tenant_id,site_id,file_name,mime_type,size_bytes,storage_key) values (${imageId},${tenant},${siteId},'imagen.png','image/png',100,${`tenants/${tenant}/sites/${siteId}/assets/imagen.png`})`
}, 90000)
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => { await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; delete process.env.APP_BASE_URL; vi.unstubAllGlobals() })
describe('Sites SEO 189 con PostgreSQL, migrador propietario y RLS reales', () => {
  it('guarda SEO sin exponer el borrador y lo publica con la versión', async () => {
    await actor(() => sites.saveSitePageDraft(tenant, userId, siteId, pageId, { title: 'Inicio', path: '/', html: '<h1>Inicio</h1>', css: '', seo: { title: 'Nuevo título' } }))
    expect((await actor(() => sites.getSitePage(tenant, siteId, pageId)))!.seo).toMatchObject({ title: 'Nuevo título' })
    expect((await domains.resolvePublishedDomain('principal189.test', '/'))!.seo).toMatchObject({ title: 'Publicado', description: 'Descripción publicada' })
    await actor(() => sites.publishSitePage(tenant, userId, siteId, pageId))
    expect((await domains.resolvePublishedDomain('principal189.test', '/'))!.seo).toMatchObject({ title: 'Nuevo título', _flowAssetTenantId: tenant })
    expect((await domains.resolvePublishedDomain('principal189.test', '/'))!.seo).not.toHaveProperty('description')
  })
  it('rechaza imagen de otro sitio, texto con HTML y modificaciones de otra organización', async () => {
    const foreignSite = randomUUID(), foreignImage = randomUUID()
    await admin`insert into sites(id,tenant_id,name,slug) values (${foreignSite},${otherTenant},'Ajeno','ajeno')`
    await admin`insert into site_assets(id,tenant_id,site_id,file_name,mime_type,size_bytes,storage_key) values (${foreignImage},${otherTenant},${foreignSite},'ajeno.png','image/png',1,'ajeno')`
    const input = { title: 'Inicio', path: '/', html: '<h1>Hola</h1>', css: '', seo: { ogImageAssetId: foreignImage } }
    await expect(actor(() => sites.saveSitePageDraft(tenant, userId, siteId, pageId, input))).rejects.toMatchObject({ statusCode: 422 })
    await expect(actor(() => sites.saveSitePageDraft(tenant, userId, siteId, pageId, { ...input, seo: { title: '<script>malo</script>' } }))).rejects.toThrow()
    expect(await actor(() => sites.saveSitePageDraft(otherTenant, userId, siteId, pageId, input))).toBeNull()
    expect(await actor(() => audit.getSiteSeoAudit(otherTenant, siteId))).toBeNull()
    expect(await actor(() => seo.setPrimarySiteDomain(otherTenant, mainId))).toBeNull()
    const context = await seo.getSiteSeoDomainContext('principal189.test')
    expect((await seo.publicSiteSeoContext({ ...(await domains.resolvePublishedDomain('principal189.test', '/'))!, seo: { ogImageAssetId: foreignImage } }, context!)).imagePath).toBeUndefined()
  })
  it('imagen publicada absoluta, alt, token de buscadores y lectura de checklist', async () => {
    await actor(() => sites.updateSite(tenant, siteId, { name: 'Sitio SEO', slug: 'seo189', locale: 'es-MX', searchVerification: { google: 'abcdefghij_012', bing: 'ABCDEF012345' } }))
    await actor(() => sites.saveSitePageDraft(tenant, userId, siteId, pageId, { title: 'Inicio', path: '/', html: '<h1>Inicio</h1>', css: '', seo: { ogImageAssetId: imageId, description: 'Social' } }))
    await actor(() => sites.publishSitePage(tenant, userId, siteId, pageId))
    const output = await handler(request('/')), doc = new JSDOM(String(output)).window.document
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://principal189.test/assets/imagen.png')
    expect(doc.querySelector('meta[property="og:image:alt"]')?.getAttribute('content')).toBe('imagen')
    expect(doc.querySelector('meta[name="google-site-verification"]')?.getAttribute('content')).toBe('abcdefghij_012')
    expect((await actor(() => audit.getSiteSeoAudit(tenant, siteId)))!.pages[0]!.total).toBeGreaterThan(20)
  })
  it('301 de alternos conserva ruta/query y elegir principal es local', async () => {
    const event = request('/ruta/?utm_source=mail&x=1', 'alterno189.test'); await handler(event)
    expect(event.node.res.statusCode).toBe(301); expect(event.node.res.getHeader('location')).toBe('https://principal189.test/ruta/?utm_source=mail&x=1')
    await actor(() => seo.setPrimarySiteDomain(tenant, otherId))
    expect((await seo.getSiteSeoDomainContext('principal189.test'))!.primary_host).toBe('alterno189.test')
    await actor(() => seo.setPrimarySiteDomain(tenant, mainId))
    const [pending] = await admin`select id from site_domains where hostname='pendiente189.test'`
    await expect(actor(() => seo.setPrimarySiteDomain(tenant, pending!.id))).rejects.toMatchObject({ statusCode: 422 })
  })
  it('canonicaliza barra final sin cambiar queries; 404 reales con noindex', async () => {
    const child = (await actor(() => sites.createSitePage(tenant, userId, siteId, { title: 'Servicios', path: '/servicios' })))!
    await actor(() => sites.publishSitePage(tenant, userId, siteId, child.id))
    const trailing = request('/servicios/?x=1'); await handler(trailing)
    expect(trailing.node.res.statusCode).toBe(301); expect(trailing.node.res.getHeader('location')).toBe('https://principal189.test/servicios?x=1')
    const missing = request('/no-existe'); const body = await handler(missing)
    expect(missing.node.res.statusCode).toBe(404); expect(body).toContain('<meta name="robots" content="noindex">')
    const caseRequest = request('/Servicios'); await handler(caseRequest); expect(caseRequest.node.res.statusCode).toBe(404)
  })
  it('sitemap excluye borradores y noindex, robots generados antes de activos', async () => {
    const hidden = (await actor(() => sites.createSitePage(tenant, userId, siteId, { title: 'Oculta', path: '/oculta' })))!
    await actor(() => sites.saveSitePageDraft(tenant, userId, siteId, hidden.id, { title: 'Oculta', path: '/oculta', html: '', css: '', seo: { noindex: true } }))
    await actor(() => sites.publishSitePage(tenant, userId, siteId, hidden.id))
    await actor(() => sites.createSitePage(tenant, userId, siteId, { title: 'Borrador', path: '/borrador' }))
    const sitemap = request('/sitemap.xml'), output = String(await handler(sitemap))
    expect(sitemap.node.res.getHeader('content-type')).toBe('application/xml; charset=utf-8'); expect(output).toContain('https://principal189.test/servicios'); expect(output).not.toContain('/oculta'); expect(output).not.toContain('/borrador')
    const robots = request('/robots.txt'); expect(await handler(robots)).toContain('Allow: /\nSitemap: https://principal189.test/sitemap.xml')
    expect(await handler(request('/robots.txt', 'pendiente189.test'))).toBe('User-agent: *\nDisallow: /\n')
    expect(await handler(request('/robots.txt', 'localhost:3000'))).toBe('User-agent: *\nDisallow: /\n')
    const unknown = request('/sitemap.xml', 'desconocido189.test'); expect(await handler(unknown)).toBe('Archivo o página no encontrados.'); expect(unknown.node.res.statusCode).toBe(404)
    await admin`update site_pages set status='draft' where site_id=${siteId}`
    expect(new JSDOM(String(await handler(request('/sitemap.xml'))), { contentType: 'text/xml' }).window.document.querySelectorAll('url')).toHaveLength(0)
    await admin`update site_pages set status='published' where site_id=${siteId} and published_version_id is not null`
  })
  it('vista previa siempre sin canónico, noindex nofollow y sin CSP nuevo', async () => {
    const event = request(`/site-preview/${siteId}/`, 'localhost:3000'), output = String(await preview(event, siteId))
    expect(output).not.toContain('rel="canonical"'); expect(output).toContain('content="noindex, nofollow"'); expect(event.node.res.getHeader('x-robots-tag')).toBe('noindex, nofollow')
    const publicEvent = request('/'); await handler(publicEvent); expect(publicEvent.node.res.getHeader('content-security-policy')).toBeUndefined()
  })
  it('host efectivo no admite cabeceras forwarded sin autenticar en Cloudflare', async () => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulado189')
    const invalid = request('/robots.txt', 'localhost:3000'); invalid.node.req.headers['x-forwarded-host'] = 'principal189.test'; invalid.node.req.headers['x-flow-edge-secret'] = 'incorrecto'; captureEdgeHost(invalid)
    expect(await handler(invalid)).toContain('Disallow: /')
    const valid = request('/robots.txt', 'localhost:3000'); valid.node.req.headers['x-forwarded-host'] = 'principal189.test'; valid.node.req.headers['x-flow-edge-secret'] = 'simulado189'; captureEdgeHost(valid)
    expect(await handler(valid)).toContain('https://principal189.test/sitemap.xml')
  })
  it('no emite una imagen cuyo alias público responde 404 cuando el inicio no está publicado', async () => {
    const page = (await domains.resolvePublishedDomain('principal189.test', '/'))!
    const context = (await seo.getSiteSeoDomainContext('principal189.test'))!
    await admin`update site_pages set status='draft' where id=${pageId}`
    try {
      const assetRequest = request('/assets/imagen.png')
      expect(await handler(assetRequest)).toBe('Archivo o página no encontrados.')
      expect(assetRequest.node.res.statusCode).toBe(404)
      expect((await seo.publicSiteSeoContext({ ...page, seo: { ogImageAssetId: imageId } }, context)).imagePath).toBeUndefined()
    } finally { await admin`update site_pages set status='published' where id=${pageId}` }
  })
})
