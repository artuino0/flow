import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { editableSiteSeo, siteSeoSchema, siteVerificationSchema } from '../../utils/siteSeo'
import { publicSeoHead, renderSiteRobots, renderSiteSitemap } from '../../server/utils/siteSeoDocument'
import { renderPublicSiteDocument, type PublicSitePage } from '../../server/utils/siteDomains'
const page: PublicSitePage = { siteId: 's', pageId: 'p', siteName: 'Empresa & asociados', siteLocale: 'es-MX', pageTitle: 'Inicio', pagePath: '/', seo: {}, html: '<h1>Hola</h1>', css: '' }
const context = { origin: 'https://ejemplo.test', rootPath: '/' }
const dom = (value: PublicSitePage, preview = false) => new JSDOM(renderPublicSiteDocument(value, undefined, undefined, { ...context, preview })).window.document
describe('SEO 189: esquema compartido', () => {
  it('admite todos los campos, booleanos y el JSON vacío', () => {
    expect(siteSeoSchema.parse({})).toEqual({})
    expect(siteSeoSchema.parse({ title: 'Título', description: 'Descripción', ogTitle: 'Social', ogDescription: 'Descripción social', twitterCard: 'summary_large_image', ogImageAssetId: '00000000-0000-4000-8000-000000000001', canonicalPath: '/servicios', noindex: true, nofollow: false })).toMatchObject({ noindex: true, nofollow: false })
  })
  it.each([{ title: 'a'.repeat(71) }, { description: 'a'.repeat(181) }, { ogTitle: '<b>Hola</b>' }, { title: 'Hola\nTexto' }, { canonicalPath: '//externo.test' }, { canonicalPath: 'https://externo.test/' }, { canonicalPath: '/%2fexterno' }, { canonicalPath: '/ruta?x=1' }, { noindex: 'true' }, { unknown: true }, { ogImageAssetId: 'https://externo.test/imagen' }])('rechaza %j', value => expect(siteSeoSchema.safeParse(value).success).toBe(false))
  it('lee datos antiguos sin aceptar claves internas del cliente', () => {
    expect(editableSiteSeo({ title: 'Título', description: 'Antiguo <texto>', _flowAssetTenantId: 't', old: true })).toEqual({ title: 'Título' })
    expect(siteSeoSchema.safeParse({ _flowAssetTenantId: 't' }).success).toBe(false)
  })
  it.each(['abcd', '<meta>abcdefghij', 'a'.repeat(101), 'abc defghi'])('rechaza token %s', token => expect(siteVerificationSchema.safeParse({ google: token }).success).toBe(false))
})
describe('SEO 189: documentos', () => {
  it('emite dominio absoluto, idioma, OG y Twitter sin imagen', () => {
    const doc = dom(page)
    expect(doc.documentElement.lang).toBe('es-MX')
    expect(doc.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://ejemplo.test/')
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://ejemplo.test/')
    expect(doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary')
    expect(doc.querySelector('meta[property="og:image"]')).toBeNull()
  })
  it('conserva etiquetas del autor sin duplicarlas; el panel explícito manda', () => {
    const html = '<html lang="en"><head><title>Autor</title><title>Duplicado</title><meta name="description" content="Autor desc"><meta property="og:title" content="Autor social"><link rel="canonical" href="https://ejemplo.test/autor"></head><body>Contenido</body></html>'
    const authored = dom({ ...page, html })
    expect(authored.querySelectorAll('title')).toHaveLength(1); expect(authored.title).toBe('Autor')
    expect(authored.querySelectorAll('meta[name=description]')).toHaveLength(1)
    expect(authored.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe('Autor social')
    expect(authored.documentElement.lang).toBe('es-MX')
    const panel = dom({ ...page, html, seo: { title: 'Panel', description: 'Panel desc', ogTitle: 'Panel social', canonicalPath: '/panel', noindex: true, nofollow: true } })
    expect(panel.querySelectorAll('title')).toHaveLength(1); expect(panel.title).toBe('Panel')
    expect(panel.querySelector('meta[name=description]')?.getAttribute('content')).toBe('Panel desc')
    expect(panel.querySelectorAll('link[rel=canonical]')).toHaveLength(1)
    expect(panel.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://ejemplo.test/panel')
    expect(panel.querySelector('meta[name=robots]')?.getAttribute('content')).toBe('noindex,nofollow')
  })
  it('escapa JSON antiguo, comillas y etiquetas sin ejecutar HTML', () => {
    const doc = dom({ ...page, seo: { title: '"><script>alert(1)</script>', description: '" & <seguro>' } })
    expect(doc.title).toBe('"><script>alert(1)</script>'); expect(doc.querySelector('meta[name=description]')?.getAttribute('content')).toBe('" & <seguro>')
    expect(doc.querySelectorAll('script')).toHaveLength(1)
  })
  it('cambiar solo título/descripcion de búsqueda respeta los campos sociales del autor', () => {
    const html = '<html><head><title>Autor</title><meta name="description" content="Autor desc"><meta property="og:title" content="Social propio"><meta property="og:description" content="Descripción social propia"><meta name="twitter:title" content="Twitter propio"></head><body></body></html>'
    const doc = dom({ ...page, html, seo: { title: 'Búsqueda nueva', description: 'Descripción nueva' } })
    expect(doc.title).toBe('Búsqueda nueva')
    expect(doc.querySelector('meta[name=description]')?.getAttribute('content')).toBe('Descripción nueva')
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe('Social propio')
    expect(doc.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe('Descripción social propia')
    expect(doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe('Twitter propio')
  })
  it('respeta scripts/comentarios y atributos con > dentro de head', () => {
    const html = '<html><head><!-- <title>No</title> --><script>var x="<title>No</title>";</script><meta name="description" content="A > B"></head><body></body></html>'
    expect(dom({ ...page, html }).querySelector('meta[name=description]')?.getAttribute('content')).toBe('A > B')
    expect(publicSeoHead({ ...page, html }).html).toContain('var x="<title>No</title>"')
  })
  it('preview noindex, nofollow, sin canónico incluso del autor', () => {
    const doc = dom({ ...page, seo: { noindex: false, nofollow: false }, html: '<html><head><link rel="canonical" href="https://ejemplo.test"><meta name="robots" content="index,follow"></head><body></body></html>' }, true)
    expect(doc.querySelector('link[rel=canonical]')).toBeNull(); expect(doc.querySelector('meta[name=robots]')?.getAttribute('content')).toBe('noindex, nofollow')
  })
  it('imagen absoluta y verificaciones solo en el inicio', () => {
    const output = renderPublicSiteDocument(page, undefined, undefined, { ...context, imagePath: '/assets/logo.png', imageAlt: 'Logo & empresa', verification: { google: '0123456789_ab', bing: 'ABCDEF012345' } })
    const doc = new JSDOM(output).window.document
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://ejemplo.test/assets/logo.png')
    expect(doc.querySelector('meta[property="og:image:alt"]')?.getAttribute('content')).toBe('Logo & empresa')
    expect(doc.querySelector('meta[name=google-site-verification]')?.getAttribute('content')).toBe('0123456789_ab')
    expect(renderPublicSiteDocument({ ...page, pagePath: '/otra' }, undefined, undefined, { ...context, verification: { google: '0123456789_ab' } })).not.toContain('google-site-verification')
  })
  it('mantiene formularios, nonce, estilos y el tema claro', () => {
    const doc = new JSDOM(renderPublicSiteDocument({ ...page, html: '<form data-flow-form="f"><input name="x"></form>', css: 'body{color:inherit}' }, undefined, 'nonce189', context)).window.document
    expect(doc.querySelector('script[data-flow-sites-runtime]')?.getAttribute('nonce')).toBe('nonce189')
    expect(doc.querySelector('script')?.textContent).toContain('/api/sites/forms/submit')
    expect(doc.querySelector('form[data-flow-form]')).not.toBeNull()
    expect(doc.querySelector('style[data-flow-sites]')?.textContent).toBe('body{color:inherit}')
    expect(doc.querySelector('meta[name=color-scheme]')?.getAttribute('content')).toBe('light')
  })
})
describe('SEO 189: sitemap y robots puros', () => {
  it('XML vacío válido, excluye noindex y duplica canónicos una sola vez', () => {
    const pages = [{ path: '/', seo: {}, lastmod: '2026-10-05' }, { path: '/privada', seo: { noindex: true }, lastmod: '2026-10-05' }, { path: '/duplicada', seo: { canonicalPath: '/' }, lastmod: '2026-10-05' }]
    const doc = new JSDOM(renderSiteSitemap(context.origin, '/', pages), { contentType: 'text/xml' }).window.document
    expect(doc.querySelectorAll('url')).toHaveLength(1); expect(doc.querySelector('lastmod')?.textContent).toBe('2026-10-05T00:00:00.000Z')
    expect(new JSDOM(renderSiteSitemap(context.origin, '/', []), { contentType: 'text/xml' }).window.document.querySelectorAll('url')).toHaveLength(0)
  })
  it('limita a 50000 URLs', () => expect((renderSiteSitemap(context.origin, '/', Array.from({ length: 50001 }, (_, i) => ({ path: `/p${i}`, seo: {}, lastmod: '2026-10-05' }))).match(/<url>/g) ?? []).length).toBe(50000))
  it('robots públicos y privados', () => { expect(renderSiteRobots(context.origin)).toBe('User-agent: *\nAllow: /\nSitemap: https://ejemplo.test/sitemap.xml\n'); expect(renderSiteRobots()).toBe('User-agent: *\nDisallow: /\n') })
  it('sitemap respeta noindex y canónico del autor; el panel explícito los reemplaza', () => {
    const html = '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="https://ejemplo.test/autor/"></head><body></body></html>'
    expect(renderSiteSitemap(context.origin, '/', [{ path: '/pagina', seo: {}, html, lastmod: '2026-10-05' }])).not.toContain('<url>')
    const seo = { noindex: false }
    expect(renderSiteSitemap(context.origin, '/', [{ path: '/pagina', seo, html, lastmod: '2026-10-05' }])).toContain('<loc>https://ejemplo.test/autor</loc>')
    expect(dom({ ...page, pagePath: '/pagina', seo, html }).querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://ejemplo.test/autor')
    expect(renderSiteSitemap(context.origin, '/', [{ path: '/pagina', seo: { noindex: false, canonicalPath: '/panel' }, html, lastmod: '2026-10-05' }])).toContain('<loc>https://ejemplo.test/panel</loc>')
  })
  it('el canónico y og:url del autor no pueden señalar otro host', () => {
    const doc = dom({ ...page, html: '<html><head><link rel="canonical" href="https://externo.test/"><meta property="og:url" content="https://externo.test/"></head><body></body></html>' })
    expect(doc.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(context.origin + '/')
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(context.origin + '/')
  })
})
