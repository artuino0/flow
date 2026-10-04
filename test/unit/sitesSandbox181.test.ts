// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { protectSiteAgendaDocument, sandboxSitePreview, siteAgendaPresentation } from '../../server/utils/siteAgenda'
import { hasSiteAuthorScripts } from '../../utils/siteAuthorScripts'
import { siteRelativeAssetName, siteRequestHasTraversal } from '../../utils/siteAssetPath'
import { sandboxSiteFormsDocument } from '../../server/utils/sitePreviewForms'
import { bootPublicAgenda } from '../../utils/publicAgendaRuntime'
import { renderPublicSiteDocument } from '../../server/utils/siteDomains'

const page = { siteId: 's', pageId: 'p', siteName: 'Sitio', siteLocale: 'es-MX', pageTitle: 'Inicio', pagePath: '/', seo: {}, html: '<script src="script.js"></script><script>window.autor=true</script><button {{openAgenda}}>Abrir</button>', css: '' }
const config = { site: 's', page: 'p', locale: 'es-MX', timezone: 'America/Mexico_City', accent: 'rgb(0 110 132)' }
let dispose: (() => void) | undefined
const originDescriptor = Object.getOwnPropertyDescriptor(window, 'origin')!
function event(path = '/site-preview/s/', host = 'localhost:3000') {
  const request = new IncomingMessage(new Socket()); request.url = path; request.headers.host = host
  return createEvent(request, new ServerResponse(request))
}
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; Object.defineProperty(window, 'origin', originDescriptor); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Sites 181: scripts del autor y origen opaco', () => {
  it('en desarrollo la agenda no impone políticas a scripts ni Referer del autor', () => {
    vi.stubEnv('NODE_ENV', 'development'); const request = event()
    protectSiteAgendaDocument(request, page)
    expect(request.node.res.getHeader('content-security-policy')).toBeUndefined()
    expect(request.node.res.getHeader('referrer-policy')).toBeUndefined()
    const html = renderPublicSiteDocument(page)
    expect(html).toContain('<script src="script.js"></script>'); expect(html).toContain('<script>window.autor=true</script>')
  })
  it('origen opaco monta agenda demostrativa y no consulta API', async () => {
    Object.defineProperty(window, 'origin', { configurable: true, value: 'null' })
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ services: [], people: [], slots: [], automatic: [], mode: 'both', requiredFields: [], formToken: '' }) }))
    vi.stubGlobal('fetch', fetch); document.body.innerHTML = '<div data-flow-agenda="inline"></div>'
    dispose = bootPublicAgenda(config); for (let i = 0; i < 12; i++) await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(document.querySelector('div')!.shadowRoot!.textContent).toContain('Vista previa con datos de ejemplo')
  })
  it.each(['development', 'production'])('dominio de sitio y página sin scripts no llevan sandbox en %s', mode => {
    vi.stubEnv('NODE_ENV', mode); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000')
    for (const request of [event('/', 'cliente.test'), event('/site-preview/s/', 'cliente.test'), event('/')]) {
      expect(sandboxSitePreview(request, page)).toBe(false); protectSiteAgendaDocument(request, page)
      expect(request.node.res.getHeader('content-security-policy')).toBeUndefined()
    }
    const request = event(); expect(sandboxSitePreview(request, { ...page, html: '<button {{openAgenda}}>Abrir</button>' })).toBe(false)
  })
  it.each(['<script src="script.js"></script>', '<button onclick="autor()">Abrir</button>', '<img title=">" onerror="autor()">'])('producción aísla solo la vista previa de app con %s', async html => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000')
    const request = event('/site-preview/s/otra'), withScripts = { ...page, html: html + '<button {{openAgenda}}>Abrir</button>' }
    expect(sandboxSitePreview(request, withScripts)).toBe(true); protectSiteAgendaDocument(request, withScripts)
    expect(request.node.res.getHeader('content-security-policy')).toBe('sandbox allow-scripts allow-forms allow-popups allow-modals')
    expect(request.node.res.getHeader('referrer-policy')).toBeUndefined()
    const presentation = await siteAgendaPresentation(request, withScripts, true)
    expect(presentation?.runtime).toMatchObject({ preview: true }); expect(renderPublicSiteDocument(withScripts, presentation)).toContain(html)
  })
  it('el modal demostrativo confirma sin API y sin publicar estado global', async () => {
    Object.defineProperty(window, 'origin', { configurable: true, value: 'null' })
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    document.body.innerHTML = '<button data-flow-agenda-open>Abrir</button>'; dispose = bootPublicAgenda(config)
    document.querySelector<HTMLButtonElement>('button')!.click(); const root = document.querySelector('body > div')!.shadowRoot!
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }; await flush()
    for (let i = 0; i < 2; i++) { root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await flush() }
    root.querySelector<HTMLButtonElement>('.slots button')!.click(); root.querySelector<HTMLButtonElement>('.footer .primary')!.click(); await flush()
    for (const name of ['name', 'email']) { const input = root.querySelector<HTMLInputElement>(`[name=${name}]`)!; input.value = name === 'email' ? 'ejemplo@test.local' : 'Visitante'; input.dispatchEvent(new Event('input')) }
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000)
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await flush()
    expect(root.textContent).toContain('¡Listo, tu cita está confirmada!'); expect(root.textContent).toContain('Vista previa con datos de ejemplo')
    expect(fetch).not.toHaveBeenCalled(); expect(Reflect.get(window, 'cfg')).toBeUndefined(); expect(Reflect.get(window, 'api')).toBeUndefined()
  })
  it.each([false, true])('formularios Flow: origen opaco=%s muestra aviso o conserva envío real', async opaque => {
    if (opaque) Object.defineProperty(window, 'origin', { configurable: true, value: 'null' })
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, submissionId: 'ejemplo' }) })); vi.stubGlobal('fetch', fetch)
    const rendered = renderPublicSiteDocument({ ...page, html: '<form data-flow-form="contacto"><input name="nombre" value="Visitante"><button type="submit">Enviar</button></form>' })
    const html = opaque ? sandboxSiteFormsDocument(rendered) : rendered
    document.body.innerHTML = html; const source = document.querySelector('script[data-flow-sites-runtime]')!.textContent!
    new Function(source)(); document.dispatchEvent(new Event('DOMContentLoaded'))
    const form = document.querySelector('form')!; form.dispatchEvent(new Event('submit', { cancelable: true })); for (let i = 0; i < 12; i++) await Promise.resolve()
    if (opaque) { expect(fetch).not.toHaveBeenCalled(); expect(form.textContent).toContain('Esta vista previa no envía formularios'); expect(form.dataset.flowState).toBe('error'); expect(form.querySelector<HTMLInputElement>('input')!.value).toBe('Visitante') }
    else { expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/sites/forms/submit', expect.objectContaining({ method: 'POST' })); expect(form.dataset.flowState).toBe('success') }
  })
})

describe('Inspección del HTML del autor y nombres relativos', () => {
  it.each(['<SCRIPT SRC="script.js"></SCRIPT>', '<div title=">" ONCLICK=x>', '<img/onerror=x>', '<!--> <script>x</script>', '<!-- --!><script>x</script>', '<svg onload=x></svg>', '<iframe srcdoc="&lt;script&gt;x&lt;/script&gt;"></iframe>', '<a href="java&#x73;cript:alert(1)">x</a>'])('reconoce scripts en %s', html => expect(hasSiteAuthorScripts(html)).toBe(true))
  it.each(['<main>Hola</main>', '<!-- <script>x</script> -->', '<div title="onclick=x">x</div>', '<textarea><script>x</script></textarea>', '<style>.x:after{content:"<script>"}</style>', '<a href="#como-funciona">Ir</a>'])('no confunde contenido inerte %s', html => expect(hasSiteAuthorScripts(html)).toBe(false))
  it.each([['/styles.css', 'styles.css'], ['/script.js', 'script.js'], ['/assets/isotipo.png', 'isotipo.png'], ['/assets/mi%20logo.png', 'mi logo.png']])('resuelve nombre %s', (path, name) => expect(siteRelativeAssetName(path!)).toBe(name))
  it.each(['/../script.js', '/assets/../script.js', '/assets/%2e%2e/script.js', '/assets/%252e%252e/script.js', '/assets/a%2fb.png', '/assets/a%5cb.png', '/assets/a%00.png', '/assets/%zz', '/a/b/c.png', '//script.js'])('rechaza %s', path => expect(siteRelativeAssetName(path)).toBeNull())
  it('detecta recorrido en la petición original antes de normalizar URL', () => {
    expect(siteRequestHasTraversal('/site-preview/s/assets/%2e%2e/script.js')).toBe(true)
    expect(siteRequestHasTraversal('/site-preview/s/assets/%252e%252e/script.js')).toBe(true)
    expect(siteRequestHasTraversal('/site-preview/s/assets/isotipo.png?next=../')).toBe(false)
  })
})
