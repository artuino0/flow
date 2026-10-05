import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { analyzeAgendaMarkers, transformAgendaMarkers } from '../../utils/agendaMarkers'
import { renderPublicSiteDocument, type PublicSitePage } from '../../server/utils/siteDomains'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/bug192-landing-row.json', import.meta.url), 'utf8'))
const row: PublicSitePage = {
  siteId: fixture.site_id,
  pageId: fixture.page_id,
  siteName: fixture.site_name,
  siteLocale: fixture.site_locale,
  pageTitle: fixture.page_title,
  pagePath: fixture.page_path,
  seo: fixture.seo,
  html: fixture.html,
  css: fixture.css
}
const budgetMs = 500

function withinBudget<T>(run: () => T): T {
  const started = performance.now()
  const result = run()
  expect(performance.now() - started).toBeLessThan(budgetMs)
  return result
}

describe('rendimiento del render público ERD-192', () => {
  it('analiza y renderiza la fila publicada de producción dentro del presupuesto', () => {
    expect(withinBudget(() => analyzeAgendaMarkers(row.html))).toEqual([])
    const rendered = withinBudget(() => renderPublicSiteDocument(row))
    expect(rendered).toContain(row.html.slice(0, 80))
    expect(rendered).toContain(row.css)
  })

  it.each([
    ['muchos cierres head', `<html><head>${'</head>'.repeat(10_000)}</html>`],
    ['head sin cierre', `<html><head>${'texto '.repeat(50_000)}`],
    ['comentario sin cierre', `<!--${'comentario '.repeat(50_000)}`],
    ['un megabyte de CSS y JS en línea', `<html><head></head><body><script>${'const value = 1;'.repeat(65_536)}</script></body></html>`, 'x'.repeat(1_000_000)],
    ['miles de metas', `<html><head>${'<meta name="x" content="y">'.repeat(10_000)}</head></html>`]
  ])('renderiza entrada adversa: %s', (_name, html, css = '') => {
    const page = { ...row, html, css }
    expect(withinBudget(() => analyzeAgendaMarkers(html))).toEqual([])
    expect(withinBudget(() => transformAgendaMarkers(html, { enabled: false, services: [], people: [] })).html).toBe(html)
    expect(withinBudget(() => renderPublicSiteDocument(page))).toContain('data-flow-sites')
  })

  it('conserva el análisis y transformación cuando existen marcadores', () => {
    const html = '<main>{{agenda-component servicio="Consulta"}}</main>'
    const markers = withinBudget(() => analyzeAgendaMarkers(html))
    expect(markers).toHaveLength(1)
    expect(withinBudget(() => transformAgendaMarkers(html, { enabled: false, services: [], people: [] })).html).toContain('{{agenda-component')
  })
})

