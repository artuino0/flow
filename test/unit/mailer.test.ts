import { afterEach, describe, it, expect } from 'vitest'
import { buildInvitationEmailHtml, getAppBaseUrl } from '../../server/utils/mailer'

// HU-ERD-84: prueba pura de buildInvitationEmailHtml (sin Postgres, sin
// SMTP), mismo criterio que test/unit/totp.test.ts - confirma que el HTML
// generado contiene el copy real del diseno (Email/Invitación Usuario en
// ERPDinamico.pen) y escapa entradas del usuario (nombre/rol/tenant) para
// evitar HTML injection en un correo que se manda a un tercero.

describe('buildInvitationEmailHtml', () => {
  const base = {
    to: 'maria.garcia@acme.com',
    tenantName: 'Acme Corp',
    inviterName: 'Juan Pérez',
    roleName: 'Ventas',
    token: 'tok',
    inviteUrl: 'https://app.erpdinamico.test/invitacion/abc123'
  }

  it('incluye el copy exacto del diseño real', () => {
    const html = buildInvitationEmailHtml(base)
    expect(html).toContain('Flow')
    expect(html).not.toContain('FlowERP')
    expect(html).not.toContain('src="flow-logo"')
    expect(html).toContain('Te invitaron a unirte a Acme Corp')
    expect(html).toContain('Juan Pérez te invitó a colaborar en el espacio de trabajo de Acme Corp en Flow. Te vas a unir con el rol de Ventas.')
    expect(html).toContain('Rol asignado')
    expect(html).toContain('Aceptar invitación')
    expect(html).toContain('Este enlace expira en 7 días')
    expect(html).toContain('¿El botón no funciona? Copia y pega este enlace en tu navegador:')
    expect(html).toContain('https://app.erpdinamico.test/invitacion/abc123')
    expect(html).toContain('Este correo fue enviado a maria.garcia@acme.com porque fue invitada a Flow.')
  })

  it('el botón enlaza al inviteUrl real', () => {
    const html = buildInvitationEmailHtml(base)
    expect(html).toContain('href="https://app.erpdinamico.test/invitacion/abc123"')
  })

  it('escapa HTML en campos con entrada de usuario (tenantName/inviterName/roleName)', () => {
    const html = buildInvitationEmailHtml({
      ...base,
      tenantName: '<script>alert(1)</script>',
      inviterName: '<b>Malicioso</b>',
      roleName: 'A & B'
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>Malicioso</b>')
    expect(html).toContain('A &amp; B')
  })
})

describe('getAppBaseUrl', () => {
  const original = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NUXT_ENV_VERCEL_ENV: process.env.NUXT_ENV_VERCEL_ENV,
    APP_PORT: process.env.APP_PORT,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    NUXT_ENV_VERCEL_PROJECT_PRODUCTION_URL: process.env.NUXT_ENV_VERCEL_PROJECT_PRODUCTION_URL
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('respeta una URL pública configurada', () => {
    process.env.APP_BASE_URL = 'https://flow.example.com/'
    expect(getAppBaseUrl()).toBe('https://flow.example.com')
  })

  it('ignora localhost en Vercel y usa el dominio de producción de Nuxt', () => {
    process.env.APP_BASE_URL = 'http://localhost:3001'
    process.env.VERCEL = '1'
    expect(() => getAppBaseUrl()).toThrow('APP_BASE_URL debe ser una URL pública en Vercel')
  })

  it('usa localhost:3000 sin variable y elimina barras finales redundantes', () => {
    delete process.env.APP_BASE_URL
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.NUXT_ENV_VERCEL_ENV
    delete process.env.APP_PORT
    expect(getAppBaseUrl()).toBe('http://localhost:3000')
    process.env.APP_BASE_URL = 'https://flow.example.com///'
    expect(getAppBaseUrl()).toBe('https://flow.example.com')
  })
})
