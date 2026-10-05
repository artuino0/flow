import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { renderPublicSiteDocument } from '../../server/utils/siteDomains'
import baseline from '../fixtures/sitePublicDocument184.json'

// Salidas calculadas con el renderer de c827950, antes del arreglo Railway.
it.each(baseline)('conserva byte por byte el documento público: $label', ({ label, html, nonce, sha256 }) => {
  const output = renderPublicSiteDocument({ siteId: 'site', pageId: 'page', siteName: 'Sitio', siteLocale: 'es-MX', pageTitle: 'Título & prueba', pagePath: '/', seo: { description: 'Texto <seguro>' }, html, css: 'body{color:inherit}' }, undefined, nonce ?? undefined)
  expect(createHash('sha256').update(output).digest('hex'), label).toBe(sha256)
})
