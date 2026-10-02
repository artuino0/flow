import { describe, expect, it } from 'vitest'
import {
  domainDnsInstructions,
  inferDomainRecordType,
  renderPublicSiteDocument
} from '../../server/utils/siteDomains'

describe('site domain DNS', () => {
  it.each([
    ['getkountly.com', 'apex'],
    ['empresa.com.mx', 'apex'],
    ['www.getkountly.com', 'subdomain'],
    ['promos.empresa.com.mx', 'subdomain']
  ] as const)('detecta %s como %s', (hostname, expected) => {
    expect(inferDomainRecordType(hostname)).toBe(expected)
  })

  it('genera un registro A para un dominio raíz', () => {
    expect(domainDnsInstructions('getkountly.com')).toEqual({
      type: 'A',
      name: '@',
      value: '76.76.21.21',
      purpose: 'routing'
    })
  })

  it('conserva el nombre completo del subdominio relativo', () => {
    expect(domainDnsInstructions('campana.ventas.empresa.com.mx')).toEqual({
      type: 'CNAME',
      name: 'campana.ventas',
      value: 'cname.vercel-dns-0.com',
      purpose: 'routing'
    })
  })

  it('permite configurar los destinos DNS desde el entorno', () => {
    const previousApex = process.env.SITES_APEX_IP
    const previousCname = process.env.SITES_CNAME_TARGET
    process.env.SITES_APEX_IP = '192.0.2.44'
    process.env.SITES_CNAME_TARGET = 'tenant.example.net'
    try {
      expect(domainDnsInstructions('empresa.com').value).toBe('192.0.2.44')
      expect(domainDnsInstructions('www.empresa.com').value).toBe('tenant.example.net')
    } finally {
      if (previousApex === undefined) delete process.env.SITES_APEX_IP
      else process.env.SITES_APEX_IP = previousApex
      if (previousCname === undefined) delete process.env.SITES_CNAME_TARGET
      else process.env.SITES_CNAME_TARGET = previousCname
    }
  })
})

describe('public site forms runtime', () => {
  it('inyecta el runtime de formularios con la identidad de sitio y página', () => {
    const html = renderPublicSiteDocument({
      siteId: '069a2a4d-4485-48b4-bf41-97727ab577c4',
      pageId: '979987d2-966b-44c3-b3b8-ef69d8e6a28b',
      siteName: 'Kountly',
      siteLocale: 'es-MX',
      pageTitle: 'Contacto',
      pagePath: '/contacto',
      seo: {},
      html: '<!doctype html><html><head></head><body><form data-flow-form="contacto"></form></body></html>',
      css: ''
    })

    expect(html).toContain('data-flow-sites-runtime')
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).toContain('<style data-flow-theme>:root{color-scheme:light!important}</style>')
    expect(html).toContain('/api/sites/forms/submit')
    expect(html).toContain('submittedPayload=payload(form)')
    expect(html).toContain("form.removeAttribute('aria-busy')}},true)")
    expect(html).toContain('069a2a4d-4485-48b4-bf41-97727ab577c4')
    expect(html).toContain('979987d2-966b-44c3-b3b8-ef69d8e6a28b')
    expect(html.indexOf('data-flow-sites-runtime')).toBeLessThan(html.indexOf('</body>'))
  })
})
