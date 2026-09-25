import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMail = vi.fn(async () => ({ messageId: 'x' }))
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }))

import { createTransporter, SmtpNotConfiguredError, sesConfigFromRow } from '../../server/utils/mailer'

const platform = { region: 'us-east-1', smtpHost: 'email-smtp.us-east-1.amazonaws.com', smtpPort: 587, smtpUser: 'u', smtpPassword: 'p' }
const row = {
  id: 'r', tenantId: 't', provider: 'ses', host: null, port: null, security: 'tls', username: null, passwordEncrypted: null, apiKeyEncrypted: null,
  fromEmail: 'nominas@empresa.com', fromName: 'Empresa RH', replyTo: 'rh@empresa.com',
  sesTenantName: 'flow-t', sesConfigSet: 'flow-t', sendingDomain: 'empresa.com', domainStatus: 'verified', dkimTokens: ['a'], sendingStatus: 'enabled',
  statusCheckedAt: null, createdBy: null, createdAt: new Date(), updatedAt: new Date()
} as never

describe('correo con Amazon SES por organización', () => {
  beforeEach(() => sendMail.mockClear())

  it('arma la configuración con las cabeceras del tenant y el remitente propio', () => {
    const config = sesConfigFromRow(row, platform)
    expect(config).toMatchObject({
      host: 'email-smtp.us-east-1.amazonaws.com', port: 587, user: 'u', security: 'tls', replyTo: 'rh@empresa.com',
      from: '"Empresa RH" <nominas@empresa.com>',
      headers: { 'X-SES-TENANT': 'flow-t', 'X-SES-CONFIGURATION-SET': 'flow-t' }
    })
  })

  it('no permite enviar con el dominio sin verificar ni con el tenant pausado', () => {
    expect(() => sesConfigFromRow({ ...(row as object), domainStatus: 'pending' } as never, platform)).toThrow(/verificado/)
    expect(() => sesConfigFromRow({ ...(row as object), sendingStatus: 'paused' } as never, platform)).toThrow(/pausado/)
    expect(() => sesConfigFromRow({ ...(row as object), sesTenantName: null } as never, platform)).toThrow(SmtpNotConfiguredError)
    expect(() => sesConfigFromRow(row, null)).toThrow(SmtpNotConfiguredError)
  })

  it('agrega las cabeceras X-SES-* a cada mensaje sin pisar las del llamador', async () => {
    const transporter = createTransporter(sesConfigFromRow(row, platform))
    await transporter.sendMail({ to: 'a@b.com', subject: 's', headers: { 'X-Otro': '1' } })
    expect(sendMail).toHaveBeenCalledWith({ to: 'a@b.com', subject: 's', headers: { 'X-SES-TENANT': 'flow-t', 'X-SES-CONFIGURATION-SET': 'flow-t', 'X-Otro': '1' } })
  })

  it('sin cabeceras configuradas el transportador queda intacto', async () => {
    const transporter = createTransporter({ host: 'h', port: 587, user: 'u', password: 'p', from: 'f@x.com' })
    await transporter.sendMail({ to: 'a@b.com', subject: 's' })
    expect(sendMail).toHaveBeenCalledWith({ to: 'a@b.com', subject: 's' })
  })
})
