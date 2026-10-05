import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createEvent, createError } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { captureEdgeHost } from '../../server/utils/effectiveHost'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { setStoredObjectAdapter, StoredObjectNotFoundError } from '../../server/utils/objectStorage'
import type { AuthTokenPayload } from '../../server/utils/auth'

let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db')
let sites: typeof import('../../server/utils/sites'), domains: typeof import('../../server/utils/siteDomains'), storage: typeof import('../../server/utils/managedStorage')
let sendPreview: typeof import('../../server/utils/publicSiteResponse').sendSitePreview
let domainHandler: typeof import('../../server/middleware/site-domain').default
const tenants = [randomUUID(), randomUUID()], objects = new Map<string, Buffer>()
const bindings: Array<{ tenant: string; site: string; page: string; user: string; role: string }> = []
const html = '<script src="script.js"></script><script>window.autor=true</script><link rel="stylesheet" href="styles.css"><img src="assets/isotipo.png"><a href="#como-funciona">Ir</a><section id="como-funciona">Hola</section><button {{openAgenda}}>Agenda tu cita</button><form data-flow-form="contacto"><input name="nombre"><button type="submit">Enviar</button></form>'
function event(url: string, host = 'localhost:3000') {
  const req = new IncomingMessage(new Socket()); req.url = url; req.headers.host = host
  return createEvent(req, new ServerResponse(req))
}
const actor = <T>(index: number, fn: () => Promise<T>) => withRecordActor({ userId: bindings[index]!.user, roleId: bindings[index]!.role }, fn)
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = 'http://localhost:3000'
  vi.stubGlobal('createError', createError)
  connection = await import('../../server/db'); sites = await import('../../server/utils/sites'); domains = await import('../../server/utils/siteDomains'); storage = await import('../../server/utils/managedStorage')
  sendPreview = (await import('../../server/utils/publicSiteResponse')).sendSitePreview
  domainHandler = (await import('../../server/middleware/site-domain')).default
  setStoredObjectAdapter({ async put({ key, body }) { objects.set(key, Buffer.from(body)) }, async get(key) { const body = objects.get(key); if (!body) throw new StoredObjectNotFoundError(); return body }, async delete(key) { objects.delete(key) } })
  for (const [index, tenant] of tenants.entries()) {
    await admin`insert into tenants(id,name,slug) values (${tenant},'Sites 181',${'sites181-' + tenant})`
    const [role] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`
    const [person] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x','Administrador') returning id`
    const [user] = await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person!.id},${role!.id}) returning id`
    bindings.push({ tenant, site: '', page: '', user: user!.id, role: role!.id })
    const created = await actor(index, () => sites.createSite(tenant, user!.id, { name: 'Sitio ' + index, slug: 'site-' + randomUUID() }))
    const [page] = await admin`select id from site_pages where site_id=${created!.id}`
    bindings[index]!.site = created!.id; bindings[index]!.page = page!.id
    await actor(index, () => sites.saveSitePageDraft(tenant, user!.id, created!.id, page!.id, { title: 'Inicio', path: '/', html, css: '' }))
    await actor(index, () => sites.publishSitePage(tenant, user!.id, created!.id, page!.id))
    await storage.storeSiteAsset(tenant, created!.id, user!.id, { fileName: 'styles.css', mimeType: 'text/css', buffer: Buffer.from(`/* sitio ${index} */ body{margin:0}`) })
    await storage.storeSiteAsset(tenant, created!.id, user!.id, { fileName: 'script.js', mimeType: 'application/octet-stream', buffer: Buffer.from(`window.sitio=${index}`) })
    await storage.storeSiteAsset(tenant, created!.id, user!.id, { fileName: 'isotipo.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, index]) })
  }
  const first = bindings[0]!
  await (await import('../../server/utils/agendaTemplate')).installAgendaTemplate(first.tenant)
  await admin`insert into records(tenant_id,entity_id,custom_data) values (${first.tenant},(select id from entities where tenant_id=${first.tenant} and slug='agenda-servicios'),'{"nombre":"Consulta real","duracion_minutos":30,"precio":100}')`
  const agenda = await import('../../server/utils/agendaPublic')
  await actor(0, () => agenda.agendaSiteAdministration({ sub: first.user, tenantId: first.tenant, roleId: first.role } as AuthTokenPayload, first.site, { enabled: true }))
  await admin`insert into site_domains(tenant_id,site_id,hostname,status) values (${first.tenant},${first.site},'cliente181.test','active')`
}, 90000)
afterEach(() => { vi.unstubAllEnvs() })
afterAll(async () => { setStoredObjectAdapter(null); await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; delete process.env.APP_BASE_URL; vi.unstubAllGlobals() })

describe('Sites 181: respuestas reales, RLS y biblioteca pública', () => {
  it('redirige la raíz sin barra, conserva query y deja herencia del fragmento al cliente', async () => {
    const site = bindings[0]!.site, request = event(`/site-preview/${site}?utm_source=correo&x=1`)
    await sendPreview(request, site)
    expect(request.node.res.statusCode).toBe(308); expect(request.node.res.getHeader('location')).toBe(`/site-preview/${site}/?utm_source=correo&x=1`)
    // Un fragmento no llega por HTTP. Location sin fragmento conserva el ancla.
    const destination = new URL(String(request.node.res.getHeader('location')), 'http://localhost:3000')
    expect(destination.hash).toBe(''); expect(destination.search).toBe('?utm_source=correo&x=1')
  })
  it.each(['development', 'production'])('publica scripts externos/inline sin script-src restrictivo en %s', async mode => {
    vi.stubEnv('NODE_ENV', mode); const site = bindings[0]!.site
    const preview = event(`/site-preview/${site}/`), domain = event('/', 'cliente181.test')
    const previewHtml = await sendPreview(preview, site), domainHtml = await domainHandler(domain)
    for (const output of [previewHtml, domainHtml]) {
      expect(output).toContain('<script src="script.js"></script>'); expect(output).toContain('<script>window.autor=true</script>'); expect(output).toContain('href="#como-funciona"'); expect(output).toContain('data-flow-sites-runtime')
    }
    expect(domain.node.res.getHeader('content-security-policy')).toBeUndefined(); expect(domain.node.res.getHeader('referrer-policy')).toBeUndefined()
    if (mode === 'production') { expect(preview.node.res.getHeader('content-security-policy')).toBe('sandbox allow-scripts allow-forms allow-popups allow-modals'); expect(previewHtml).toContain('"preview":true'); expect(previewHtml).toContain('data-flow-agenda-runtime') }
    else { expect(preview.node.res.getHeader('content-security-policy')).toBeUndefined(); expect(previewHtml).toContain('"assignmentMode":"both"'); expect(previewHtml).not.toContain('"preview":true'); expect(previewHtml).toContain('data-flow-agenda-runtime') }
    expect(preview.node.res.getHeader('referrer-policy')).toBeUndefined()
  })
  it.each([['styles.css', 'text/css'], ['script.js', 'text/javascript'], ['assets/isotipo.png', 'image/png']])('resuelve %s con MIME %s en preview y dominio', async (name, mime) => {
    const site = bindings[0]!.site, preview = event(`/site-preview/${site}/${name}`), domain = event('/' + name, 'cliente181.test')
    for (const [request, output] of [[preview, await sendPreview(preview, site, '/' + name)], [domain, await domainHandler(domain)]] as const) {
      expect(Buffer.isBuffer(output)).toBe(true); expect(request.node.res.statusCode).toBe(200)
      expect(request.node.res.getHeader('content-type')).toBe(mime); expect(request.node.res.getHeader('x-content-type-options')).toBe('nosniff'); expect(request.node.res.getHeader('access-control-allow-origin')).toBe('*')
      if (name === 'script.js') expect(String(output)).toBe('window.sitio=0')
    }
  })
  it('misma ruta en otro tenant entrega solo su archivo y no acepta metadatos ajenos', async () => {
    const first = bindings[0]!, second = bindings[1]!
    expect(String(await sendPreview(event(`/site-preview/${second.site}/script.js`), second.site, '/script.js'))).toBe('window.sitio=1')
    const published = (await domains.resolvePublishedPreview(first.site, '/'))!
    expect(await storage.getRelativeSiteAsset({ ...published, seo: { _flowAssetTenantId: second.tenant } }, '/script.js')).toBeNull()
    const [foreign] = await admin`select id from site_assets where site_id=${second.site} and file_name='script.js'`
    expect(await storage.getPublicSiteAsset(first.tenant, foreign!.id)).toBeNull()
  })
  it('no entrega un archivo de otro sitio de la misma organización', async () => {
    const first = bindings[0]!, otherSite = randomUUID()
    await admin`insert into sites(id,tenant_id,name,slug,status) values (${otherSite},${first.tenant},'Otro sitio',${'other-' + otherSite},'published')`
    await storage.storeSiteAsset(first.tenant, otherSite, first.user, { fileName: 'solo-otro.js', mimeType: 'text/javascript', buffer: Buffer.from('otro sitio') })
    const request = event(`/site-preview/${first.site}/solo-otro.js`)
    expect(await sendPreview(request, first.site, '/solo-otro.js')).toBe('Archivo o página no encontrados.'); expect(request.node.res.statusCode).toBe(404)
  })
  it.each(['/no-existe.css', '/assets/../script.js', '/assets/%2e%2e/script.js', '/assets/%252e%252e/script.js', '/assets/a%2fscript.js', '/assets/a%5cb.png'])('404 de texto plano ante %s, en ambos orígenes', async path => {
    const site = bindings[0]!.site, preview = event(`/site-preview/${site}${path}`), domain = event(path, 'cliente181.test')
    for (const [request, output] of [[preview, await sendPreview(preview, site, path)], [domain, await domainHandler(domain)]] as const) {
      expect(request.node.res.statusCode).toBe(404); expect(request.node.res.getHeader('content-type')).toBe('text/plain; charset=utf-8'); expect(request.node.res.getHeader('x-content-type-options')).toBe('nosniff'); expect(typeof output).toBe('string'); expect(String(output)).not.toContain('{')
    }
  })
  it('la página publicada prevalece sobre un alias y las páginas hijas se conservan', async () => {
    const first = bindings[0]!
    const child = await actor(0, () => sites.createSitePage(first.tenant, first.user, first.site, { title: 'Otra', path: '/otra' }))
    await actor(0, () => sites.saveSitePageDraft(first.tenant, first.user, first.site, child!.id, { title: 'Otra', path: '/otra', html: '<h1>Otra página</h1>', css: '' }))
    await actor(0, () => sites.publishSitePage(first.tenant, first.user, first.site, child!.id))
    const request = event(`/site-preview/${first.site}/otra`)
    expect(await sendPreview(request, first.site, '/otra')).toContain('<h1>Otra página</h1>'); expect(request.node.res.getHeader('content-type')).toBe('text/html; charset=utf-8')
    vi.stubEnv('NODE_ENV', 'production'); const production = event(`/site-preview/${first.site}/otra`)
    await sendPreview(production, first.site, '/otra'); expect(production.node.res.getHeader('content-security-policy')).toBeUndefined()
  })
  it('Cloudflare sirve HTML y archivos solo con borde autenticado y respeta hosts reservados', async () => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge')
    const forwarded = (path: string, secret: string, hostname = 'cliente181.test') => {
      const request = event(path, 'origin.flow.test')
      request.node.req.headers['x-forwarded-host'] = hostname; request.node.req.headers['x-flow-edge-secret'] = secret
      captureEdgeHost(request); return request
    }
    for (const secret of ['', 'incorrecto']) expect(await domainHandler(forwarded('/', secret))).toBeUndefined()
    expect(await domainHandler(forwarded('/', 'simulated-edge'))).toContain('<script>window.autor=true</script>')
    const asset = forwarded('/script.js', 'simulated-edge')
    expect(String(await domainHandler(asset))).toBe('window.sitio=0')
    expect(asset.node.res.getHeader('content-type')).toBe('text/javascript')
    expect(asset.node.req.headers['x-flow-edge-secret']).toBeUndefined()
    expect(await domainHandler(forwarded('/', 'simulated-edge', 'localhost'))).toBeUndefined()
    vi.stubEnv('APP_BASE_URL', 'https://app.flow.test')
    expect(await domainHandler(forwarded('/', 'simulated-edge', 'app.flow.test'))).toBeUndefined()
    expect(await domainHandler(forwarded('/agenda-manage/site/page', 'simulated-edge'))).toBeUndefined()
  })
  it('zona propia: alternos redirigen al principal que sirve el sitio y /agenda; app queda reservado', async () => {
    vi.stubEnv('SITE_DOMAIN_PROVIDER', 'cloudflare'); vi.stubEnv('CLOUDFLARE_EDGE_SECRET', 'simulated-edge')
    vi.stubEnv('APP_BASE_URL', 'https://app.dydasoftware.com'); vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'app.dydasoftware.com')
    vi.stubEnv('CLOUDFLARE_ZONE_NAME', 'dydasoftware.com'); vi.stubEnv('CLOUDFLARE_FALLBACK_ORIGIN', 'app.dydasoftware.com')
    const first = bindings[0]!
    for (const hostname of ['flow.dydasoftware.com', 'dydasoftware.com', 'www.dydasoftware.com']) {
      await admin`insert into site_domains(tenant_id,site_id,hostname,status,provider,provider_data) values (${first.tenant},${first.site},${hostname},'active','cloudflare','{"cloudflare":{"managedByZone":true,"managementReason":"own_zone","dnsVerified":true,"edgeVerified":true}}')`
    }
    const child = await actor(0, () => sites.createSitePage(first.tenant, first.user, first.site, { title: 'Agenda propia', path: '/agenda' }))
    await actor(0, () => sites.saveSitePageDraft(first.tenant, first.user, first.site, child!.id, { title: 'Agenda propia', path: '/agenda', html: '<h1>Agenda propia</h1>', css: '' }))
    await actor(0, () => sites.publishSitePage(first.tenant, first.user, first.site, child!.id))
    for (const hostname of ['flow.dydasoftware.com', 'dydasoftware.com', 'www.dydasoftware.com']) {
      const request = (path: string) => {
        const e = event(path, 'app.dydasoftware.com'); e.node.req.headers['x-forwarded-host'] = hostname; e.node.req.headers['x-flow-edge-secret'] = 'simulated-edge'; captureEdgeHost(e); return e
      }
      for (const path of ['/', '/agenda']) {
        const alternate = request(path); await domainHandler(alternate)
        expect(alternate.node.res.statusCode).toBe(301)
        expect(alternate.node.res.getHeader('location')).toBe(`https://cliente181.test${path}`)
        const primary = event(path, 'app.dydasoftware.com'); primary.node.req.headers['x-forwarded-host'] = 'cliente181.test'; primary.node.req.headers['x-flow-edge-secret'] = 'simulated-edge'; captureEdgeHost(primary)
        expect(await domainHandler(primary)).toContain(path === '/' ? '<script>window.autor=true</script>' : '<h1>Agenda propia</h1>')
      }
    }
    expect(await domainHandler(event('/', 'app.dydasoftware.com'))).toBeUndefined()
    await expect(domains.createSiteDomain(first.tenant, first.user, { siteId: first.site, hostname: 'app.dydasoftware.com' })).rejects.toMatchObject({ statusCode: 422, statusMessage: expect.stringContaining('reservado') })
  })
  it('duplicados, objeto ausente, clave privada, límite y sitio sin referencia fallan cerrado', async () => {
    const first = bindings[0]!, published = (await domains.resolvePublishedPreview(first.site, '/'))!
    await storage.storeSiteAsset(first.tenant, first.site, first.user, { fileName: 'script.js', mimeType: 'text/javascript', buffer: Buffer.from('duplicado') })
    expect(await storage.getRelativeSiteAsset(published, '/script.js')).toBeNull()
    expect(await storage.getRelativeSiteAsset({ ...published, seo: {} }, '/styles.css')).toBeNull()
    const [asset] = await admin`select id,storage_key from site_assets where site_id=${first.site} and file_name='styles.css'`
    await admin`update site_assets set storage_key=${`tenants/${first.tenant}/files/privado`} where id=${asset!.id}`
    expect(await storage.getRelativeSiteAsset(published, '/styles.css')).toBeNull()
    await admin`update site_assets set storage_key=${asset!.storage_key},size_bytes=${storage.MAX_SITE_ASSET_BYTES + 1} where id=${asset!.id}`
    expect(await storage.getRelativeSiteAsset(published, '/styles.css')).toBeNull()
    await admin`update site_assets set size_bytes=20 where id=${asset!.id}`; objects.delete(asset!.storage_key)
    const request = event(`/site-preview/${first.site}/styles.css`)
    await sendPreview(request, first.site, '/styles.css'); expect(request.node.res.statusCode).toBe(404); expect(request.node.res.getHeader('content-type')).toBe('text/plain; charset=utf-8')
  })
  it('subida conserva tipos anteriores, rechaza HTML y el máximo de 15 MiB', async () => {
    const first = bindings[0]!
    await expect(storage.storeSiteAsset(first.tenant, first.site, first.user, { fileName: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<script>x</script>') })).rejects.toBeInstanceOf(storage.SiteAssetInvalidTypeError)
    await expect(storage.storeSiteAsset(first.tenant, first.site, first.user, { fileName: 'grande.css', mimeType: 'text/css', buffer: Buffer.alloc(storage.MAX_SITE_ASSET_BYTES + 1) })).rejects.toBeInstanceOf(storage.SiteAssetTooLargeError)
    const fonts = await storage.storeSiteAsset(first.tenant, first.site, first.user, { fileName: 'fuente.woff2', mimeType: 'font/woff2', buffer: Buffer.from('fuente') })
    expect(fonts.mimeType).toBe('font/woff2'); expect(fonts.publicUrl).toContain('/site-assets/')
  })
})
