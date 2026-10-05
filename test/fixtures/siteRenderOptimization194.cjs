// Se ejecuta únicamente en un proceso local con --allow-natives-syntax.
const { buildSync } = require('esbuild')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const bundle = buildSync({
  stdin: { contents: "export { analyzeAgendaMarkers } from './utils/agendaMarkers'; export { renderPublicSiteDocument } from './server/utils/siteDomains'", resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
  alias: { '~': root, 'nitropack/runtime/context': path.join(root, 'node_modules/nitropack/dist/runtime/context.mjs') }, write: false, logLevel: 'silent'
}).outputFiles[0].text
const compiled = { exports: {} }
new Function('require', 'module', 'exports', '__dirname', bundle)(createRequire(path.join(root, 'package.json')), compiled, compiled.exports, root)
const { analyzeAgendaMarkers, renderPublicSiteDocument } = compiled.exports
const fixture = JSON.parse(readFileSync(path.join(root, 'test/fixtures/bug192-landing-row.json'), 'utf8'))
const html = Buffer.from(fixture.html + '{{agenda-component}}<button {{openAgenda}}>Abrir</button>').toString('utf8')
const page = { siteId: fixture.site_id, pageId: fixture.page_id, siteName: fixture.site_name, siteLocale: fixture.site_locale, pageTitle: fixture.page_title, pagePath: fixture.page_path, seo: fixture.seo, html, css: fixture.css };
const prepare = new Function('fn', '%PrepareFunctionForOptimization(fn)')
const optimize = new Function('fn', '%OptimizeFunctionOnNextCall(fn)')
const optimizationStatus = new Function('fn', 'return %GetOptimizationStatus(fn)')
prepare(analyzeAgendaMarkers)
const before = renderPublicSiteDocument(page)
for (let i = 0; i < 10; i++) analyzeAgendaMarkers(html);
optimize(analyzeAgendaMarkers)
const started = performance.now()
const markers = analyzeAgendaMarkers(html)
const after = renderPublicSiteDocument(page, undefined, undefined, undefined, markers)
const elapsedMs = performance.now() - started
console.log(JSON.stringify({ elapsedMs, equal: before === after, markers: markers.length, optimizationStatus: optimizationStatus(analyzeAgendaMarkers) }))
