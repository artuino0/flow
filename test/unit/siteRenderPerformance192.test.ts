import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { previousAnalyzeAgendaMarkers } from '../fixtures/agendaMarkersBefore194'
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


const agendaConfig = { enabled: true, services: [{ id: 's', name: 'Consulta' }], people: [{ id: 'p', name: 'Ana' }] }
const validMarkers = '{{agenda-component servicio="Consulta"}}<button {{openAgenda personal="Ana"}}>Abrir</button>'

describe('rendimiento y equivalencia ERD-194', () => {
  it.each([
    ['válidos', row.html + validMarkers],
    ['inválidos', row.html + '{{agenda-bad}}<div {{openAgenda}}>{{agenda-component servicio=no}}</div>'],
    ['muchos', '<main>' + validMarkers.repeat(2000) + '</main>'],
    ['un MB con marcadores', '<main>' + '<p class="contenido">Texto</p>'.repeat(37000) + validMarkers + '</main>'],
    ['llaves ajenas sin cierre', '{{otro '.repeat(160000) + validMarkers]
  ])('analiza y transforma %s en menos de 500 ms', (_name, source) => {
    // Mismo origen de cadenas que postgres.js: decodificación UTF-8, no solo JSON.
    const html = Buffer.from(source).toString('utf8')
    const markers = withinBudget(() => analyzeAgendaMarkers(html))
    expect(markers.length).toBeGreaterThan(0)
    const transformed = withinBudget(() => transformAgendaMarkers(html, agendaConfig, markers))
    expect(transformed.markers).toBe(markers)
    expect(withinBudget(() => renderPublicSiteDocument({ ...row, html })).length).toBeGreaterThan(0)
  })

  it('conserva exactamente posiciones, raw, parámetros parciales, contexto y kind', () => {
    const corpus = [validMarkers, '{{ AGENDA-COMPONENT }}', '{{agenda-algo}}', '{{openAgenda}}',
      '<button {{ OPENAGENDA personal="ana" }}>Abrir</button>', '<div title="{{agenda-component}}">Texto</div>',
      '<button value={{openAgenda}}>Texto</button>', '<!-- {{agenda-component}} -->',
      '{{agenda-component servicio="a" servicio="b"}}', '{{agenda-component servicio="a" basura}}',
      '<script>{{agenda-component}}</script>', '<textarea>{{agenda-component}}</textarea>',
      '<template>{{agenda-component}}</template>', '<svg><text>{{agenda-component}}</text></svg>',
      '<style>{{agenda-component}}</style>', '<button abc{{openAgenda}}>', '<button {{openAgenda}}/ >',
      '{{agenda-component', '<!-- sin cierre {{agenda-component}}', '<x- {{openAgenda}}>',
      ...[9,10,11,12,13,32,160,5760,8192,8202,8232,8233,8239,8287,12288,65279].map(code => `<button${String.fromCharCode(code)}{{openAgenda}}>`) ]
    let state = 194
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state }
    const parts = ['<button ', '<a ', '<div ', '</button ', '>', '=', '"', "'", '/', 'İ', '漢字',
      '{{agenda-component}}', '{{openAgenda}}', '{{foo}}', '{{agenda-', '<!--', '-->',
      ' servicio="Consulta" ', ' personal="Ana" ', 'x', ' ', '\n', '<script>', '</script>', '<svg>', '</svg>']
    for (let n = 0; n < 3000; n++) {
      let html = ''
      for (let j = 0, count = random() % 40; j < count; j++) html += parts[random() % parts.length]
      corpus.push(html)
    }
    for (const html of corpus) expect(analyzeAgendaMarkers(html), html).toEqual(previousAnalyzeAgendaMarkers(html))
  })
})
