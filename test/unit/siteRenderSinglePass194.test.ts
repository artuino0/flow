import { afterEach, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import * as markers from '../../utils/agendaMarkers'
import * as agenda from '../../server/utils/siteAgenda'
import * as domains from '../../server/utils/siteDomains'
import { sendSitePreview } from '../../server/utils/publicSiteResponse'
import publicDomain from '../../server/middleware/site-domain'

const state = vi.hoisted(() => ({ page: null as import('../../server/utils/siteDomains').PublicSitePage | null }))
vi.mock('../../utils/agendaMarkers', async load => {
  const actual = await load<typeof import('../../utils/agendaMarkers')>()
  return { ...actual, analyzeAgendaMarkers: vi.fn(actual.analyzeAgendaMarkers), transformAgendaMarkers: vi.fn(actual.transformAgendaMarkers) }
})
vi.mock('../../server/utils/siteDomains', async load => {
  const actual = await load<typeof import('../../server/utils/siteDomains')>()
  return { ...actual, resolvePublishedPreview: vi.fn(async () => state.page), resolvePublishedDomain: vi.fn(async () => state.page), isActiveSiteDomain: vi.fn(async () => true) }
})
vi.mock('../../server/utils/agendaPublic', () => ({
  agendaFlowOrigin: () => 'http://localhost:3000', resolveAgendaContext: vi.fn(async () => ({})),
  publicAgendaPresentation: vi.fn(async () => ({ enabled: true, services: [], people: [], runtime: { site: 's', page: 'p', locale: 'es-MX', timezone: 'UTC', accent: 'inherit' } }))
}))
vi.mock('../../server/utils/siteSeoPublic', () => ({
  getSiteSeoDomainContext: vi.fn(async () => ({ primary_host: 'cliente.test', root_path: '/', status: 'active' })),
  publicSiteSeoContext: vi.fn(async () => ({ origin: 'https://cliente.test', rootPath: '/' })),
  getSiteSitemapPages: vi.fn(async () => [])
}))
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

it.each(['dominio', 'preview'])('analiza una sola vez y comparte el resultado en %s', async mode => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000'); vi.stubEnv('SITE_DOMAIN_PROVIDER', '')
  const site = '11111111-1111-4111-8111-111111111111'
  state.page = { siteId: site, pageId: 'p', siteName: 'Sitio', siteLocale: 'es-MX', pageTitle: 'Inicio', pagePath: '/', seo: {}, css: '', html: '<script>window.autor=true</script>{{agenda-component}}<button {{openAgenda}}>Abrir</button>' }
  const request = new IncomingMessage(new Socket())
  request.url = mode === 'preview' ? `/site-preview/${site}/` : '/'
  request.headers.host = mode === 'preview' ? 'localhost:3000' : 'cliente.test'
  const event = createEvent(request, new ServerResponse(request))
  const presentation = vi.spyOn(agenda, 'siteAgendaPresentation')
  const protection = vi.spyOn(agenda, 'protectSiteAgendaDocument')
  const render = vi.spyOn(domains, 'renderPublicSiteDocument')
  const document = mode === 'preview' ? await sendSitePreview(event, site) : await publicDomain(event)
  expect(document).toContain('data-flow-agenda="inline"')
  expect(event.node.res.getHeader('cache-control')).toBe('no-store')
  expect(markers.analyzeAgendaMarkers).toHaveBeenCalledTimes(1)
  const analyzed = vi.mocked(markers.analyzeAgendaMarkers).mock.results[0]!.value
  expect(presentation.mock.calls[0]![3]).toBe(analyzed)
  expect(protection.mock.calls[0]![2]).toBe(analyzed)
  expect(render.mock.calls[0]![4]).toBe(analyzed)
  expect(markers.transformAgendaMarkers).toHaveBeenCalledExactlyOnceWith(state.page.html, expect.any(Object), analyzed)
})
