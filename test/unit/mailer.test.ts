import { describe, it, expect } from 'vitest'
import { buildInvitationEmailHtml } from '../../server/utils/mailer'

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
    expect(html).toContain('ERP Dinámico')
    expect(html).toContain('Te invitaron a unirte a Acme Corp')
    expect(html).toContain('Juan Pérez te invitó a colaborar en el espacio de trabajo de Acme Corp en ERP Dinámico. Te vas a unir con el rol de Ventas.')
    expect(html).toContain('Rol asignado')
    expect(html).toContain('Aceptar invitación')
    expect(html).toContain('Este enlace expira en 7 días')
    expect(html).toContain('¿El botón no funciona? Copia y pega este enlace en tu navegador:')
    expect(html).toContain('https://app.erpdinamico.test/invitacion/abc123')
    expect(html).toContain('Este correo fue enviado a maria.garcia@acme.com porque fue invitada a ERP Dinámico.')
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
