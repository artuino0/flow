import { describe, expect, it } from 'vitest'
import { auditSiteSeo, type SeoAuditPage, type SeoAuditSite } from '../../utils/siteSeoAudit'
const page: SeoAuditPage = { id: 'p', title: 'Un título suficientemente claro para buscar', path: '/', status: 'published', html: '<h1>Título</h1><h2>Contenido</h2><p>' + 'palabra '.repeat(301) + '</p><a href="/otra">Nuestros servicios</a><img src="/assets/imagen.png" alt="Imagen" width="1200" height="630">', css: '', seo: { description: 'Una descripción propia que explica con claridad los servicios que ofrecemos y cómo puedes encontrarnos.', ogImageAssetId: 'image' } }
const site: SeoAuditSite = { locale: 'es-MX', domainActive: true, primary: true, googleVerified: true, rootPath: '/', pages: [page, { ...page, id: 'other', title: 'Otro título propio de la otra página', path: '/otra', seo: { description: 'Otra descripción diferente' } }], assets: [{ id: 'image', fileName: 'imagen.png', sizeBytes: 10000 }] }
const check = (id: string, input: Partial<SeoAuditPage> = {}, context: Partial<SeoAuditSite> = {}) => auditSiteSeo({ ...page, ...input }, { ...site, ...context }).items.find(item => item.id === id)!
describe('Checklist 189: reglas independientes', () => {
  it.each(['title', 'description', 'duplicates', 'locale', 'h1', 'headings', 'text', 'links', 'broken', 'generic', 'alt', 'dimensions', 'heavy', 'sharing', 'twitter', 'published', 'noindex', 'canonical', 'sitemap', 'domain', 'primary', 'google', 'home', 'viewport', 'mixed', 'weight', 'scripts'])('%s listo con contenido suficiente', id => { expect(check(id).state).toBe('ok'); expect(check(id).fix.length).toBeGreaterThan(5) })
  it.each([
    ['title', { title: '', html: '' }, 'falta'], ['title', { title: 'Corto' }, 'aviso'],
    ['description', { seo: {} }, 'falta'], ['description', { seo: { description: 'Corta' } }, 'aviso'],
    ['h1', { html: '<h2>Sin principal</h2>' }, 'falta'], ['h1', { html: '<h1>A</h1><h1>B</h1>' }, 'aviso'],
    ['headings', { html: '<h1>A</h1><h3>B</h3>' }, 'aviso'], ['text', { html: '<p>Poco texto</p>' }, 'aviso'],
    ['links', { html: '<a href="https://externo.test">Externo</a>' }, 'aviso'],
    ['broken', { html: '<a href="/no-publicada">Página</a>' }, 'falta'],
    ['generic', { html: '<a href="/otra">clic aquí</a>' }, 'aviso'],
    ['alt', { html: '<img src="/assets/imagen.png">' }, 'falta'],
    ['dimensions', { html: '<img alt="" src="/assets/imagen.png">' }, 'aviso'],
    ['socialImage', { seo: {} }, 'falta'], ['sharing', { seo: {} }, 'falta'],
    ['twitter', { seo: {} }, 'falta'], ['published', { status: 'draft' }, 'falta'],
    ['noindex', { seo: { noindex: true } }, 'aviso'], ['sitemap', { seo: { noindex: true } }, 'falta'],
    ['canonical', { seo: { canonicalPath: '//externo.test' } }, 'falta'],
    ['mixed', { html: '<img src="http://inseguro.test/a.png">' }, 'aviso'],
    ['weight', { html: 'ñ'.repeat(80000) }, 'aviso'],
    ['scripts', { html: '<script src="/script.js"></script>' }, 'aviso']
  ] as Array<[string, Partial<SeoAuditPage>, string]>)('%s: %s → %s', (id, input, state) => expect(check(id, input).state).toBe(state))
  it.each(['domain', 'primary', 'google', 'home', 'locale'])('detecta falta del sitio: %s', id => {
    expect(check(id, {}, { domainActive: false, primary: false, googleVerified: false, pages: [], locale: '' }).state).toBe('falta')
  })
  it('detecta peso mayor de 500 KB solo en imágenes usadas', () => expect(check('heavy', {}, { assets: [{ id: 'image', fileName: 'imagen.png', sizeBytes: 500001 }] }).state).toBe('aviso'))
  it('solo compara duplicados con las páginas que recibe del sitio', () => {
    expect(check('duplicates', {}, { pages: [page, { ...page, id: 'duplicate' }] }).state).toBe('aviso')
    expect(check('duplicates', {}, { pages: [page] }).state).toBe('ok')
  })
  it('usa el head propio y no ejecuta scripts ni cuenta su texto', () => {
    const own = { ...page, title: '', seo: {}, html: '<html><head><title>Un título escrito por el autor de la página</title><meta name="description" content="Una descripción suficientemente extensa para que la tarjeta de búsqueda explique el contenido."><meta name="robots" content="noindex"></head><body><script>throw new Error("nunca")</script><h1>Hola</h1></body></html>' }
    expect(check('title', own).state).toBe('ok'); expect(check('description', own).state).toBe('ok'); expect(check('noindex', own).state).toBe('aviso')
    expect(check('noindex', { ...own, seo: { noindex: false } }).state).toBe('ok')
  })
  it('tolera HTML mal formado, limita HTML enorme y ordena falta primero', () => {
    expect(() => auditSiteSeo({ ...page, html: '<h1>Abierto<a href="/sin-fin"><script>no ejecutar' }, site)).not.toThrow()
    expect(auditSiteSeo({ ...page, html: 'a'.repeat(200001) }, site)).toMatchObject({ ready: 0, total: 1 })
    const result = auditSiteSeo({ ...page, html: '', seo: {} }, site)
    expect(result.items[0]?.state).toBe('falta'); expect(result.ready).toBeLessThan(result.total)
  })
})
