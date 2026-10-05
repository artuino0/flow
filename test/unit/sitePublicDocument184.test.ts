import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { renderPublicSiteDocument } from '../../server/utils/siteDomains'
import { transformAgendaMarkers } from '../../utils/agendaMarkers'
import { publicAgendaRuntime } from '../../utils/publicAgendaRuntime'
import baseline from '../fixtures/sitePublicDocument184.json'

// HU-189 cambia solo la cabecera SEO/lang. La referencia original mantiene sus hashes;
// cuerpo, runtimes y estilos publicados deben conservarse byte por byte.
const originalCode = ts.transpileModule(readFileSync('test/fixtures/sitePublicRenderer188.ts.txt', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const originalExports: { renderPublicSiteDocument?: typeof renderPublicSiteDocument } = {}
new Function('exports', 'transformAgendaMarkers', 'publicAgendaRuntime', originalCode)(originalExports, transformAgendaMarkers, publicAgendaRuntime)
it.each(baseline)('conserva cuerpo, runtime, nonce y estilos del documento público: $label', ({ label, html, nonce, sha256 }) => {
  const page = { siteId: 'site', pageId: 'page', siteName: 'Sitio', siteLocale: 'es-MX', pageTitle: 'Título & prueba', pagePath: '/', seo: { description: 'Texto <seguro>' }, html, css: 'body{color:inherit}' }
  const before = originalExports.renderPublicSiteDocument!(page, undefined, nonce ?? undefined)
  const output = renderPublicSiteDocument(page, undefined, nonce ?? undefined)
  expect(createHash('sha256').update(before).digest('hex'), label).toBe(sha256)
  const oldDocument = new JSDOM(before).window.document, document = new JSDOM(output).window.document
  expect(document.body.innerHTML, label).toBe(oldDocument.body.innerHTML)
  expect([...document.querySelectorAll('style')].map(style => style.outerHTML), label).toEqual([...oldDocument.querySelectorAll('style')].map(style => style.outerHTML))
  expect(document.documentElement.lang).toBe('es-MX')
})
