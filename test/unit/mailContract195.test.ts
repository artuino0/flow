import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SESv2Client } from '@aws-sdk/client-sesv2'
import { mailServer195, type MailMode } from '../helpers/mailServer195'
import { smtpTransport } from '../../server/utils/mail/smtp'
import { sesTransport } from '../../server/utils/mail/ses'
import { resendTransport } from '../../server/utils/mail/resend'
import { postmarkTransport } from '../../server/utils/mail/postmark'
import { mailtrapTransport } from '../../server/utils/mail/mailtrap'
import { senderStatus, type MailMessage, type MailTransport } from '../../server/utils/mail/types'
import { matchesVerificationCode, newVerificationCode, verificationHash } from '../../server/utils/verificationCode'

const message: MailMessage = { from: 'Flow <sender@local.test>', to: ['one@local.test', 'two@local.test'], cc: ['cc@local.test'], bcc: ['hidden@local.test'],
  replyTo: 'reply@local.test', subject: 'Prueba', html: '<p>Mensaje</p>', text: 'Mensaje', headers: { 'X-Test': 'shared-contract' },
  attachments: [{ filename: 'prueba.txt', content: Buffer.from('archivo-de-prueba'), contentType: 'text/plain', cid: 'test-inline' }], jobId: 'job-195' }
describe.each(['smtp', 'ses', 'mailtrap', 'resend', 'postmark'])('contrato MailTransport: %s', name => {
  let server: Awaited<ReturnType<typeof mailServer195>>, transport: MailTransport, client: SESv2Client | undefined
  beforeAll(async () => {
    vi.stubEnv('MAIL_TIMEOUT_MS', '250')
    server = await mailServer195(name === 'smtp')
    if (name === 'smtp') transport = smtpTransport({ host: '127.0.0.1', port: server.port, security: 'none' })
    if (name === 'resend') transport = resendTransport('local-key', server.url + '/resend')
    if (name === 'postmark') transport = postmarkTransport('local-key', server.url + '/postmark')
    if (name === 'mailtrap') transport = mailtrapTransport('local-key', 'local-inbox', server.url + '/mailtrap')
    if (name === 'ses') {
      client = new SESv2Client({ region: 'us-east-1', endpoint: server.url, credentials: { accessKeyId: 'local-key', secretAccessKey: 'local-secret' }, maxAttempts: 1 })
      transport = sesTransport('us-east-1', client)
    }
  })
  afterAll(async () => { client?.destroy(); await server.stop(); vi.unstubAllEnvs() })
  it('configuración local y aceptación con id', async () => {
    server.setMode('success')
    expect(await transport.check()).toEqual({ status: 'ok' })
    expect((await transport.send(message)).id).toBeTruthy()
  })
  it.each(['reject', 'server', 'timeout', 'malformed'] as MailMode[])('rechaza %s dentro del tiempo total sin filtrar datos del proveedor', async mode => {
    server.setMode(mode)
    const started = Date.now()
    await expect(transport.send(message)).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1800)
    server.setMode('success')
  })
  it('mantiene adjuntos, cabeceras, Reply-To y destinatarios múltiples', async () => {
    await transport.send(message)
    const wire = server.requests.at(-1)!.body
    const body = name === 'ses' ? Buffer.from(JSON.parse(wire).Content.Raw.Data, 'base64').toString() : wire
    for (const value of ['one@local.test', 'two@local.test', 'reply@local.test', 'shared-contract', 'prueba.txt']) expect(body).toContain(value)
    expect(body).toContain(Buffer.from('archivo-de-prueba').toString('base64'))
  })
})
it('remitente marcador y remitente ausente son errores de configuración', () => {
  for (const from of ['', 'Flow <test@example.com>', 'Flow <test@tu-dominio.com>', 'bad\r\n@local.test']) expect(senderStatus(from).status).toBe('misconfigured')
  expect(senderStatus(message.from).status).toBe('ok')
})
it('OTP criptográfico, HMAC ligado al identificador y comparación segura', () => {
  vi.stubEnv('JWT_SECRET', 'local-verification-test-195')
  const code = newVerificationCode(), hash = verificationHash('id-one', code)
  expect(code).toMatch(/^\d{6}$/); expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(matchesVerificationCode('id-one', code, hash)).toBe(true)
  expect(matchesVerificationCode('id-two', code, hash)).toBe(false)
  expect(matchesVerificationCode('id-one', '123', hash)).toBe(false)
  vi.unstubAllEnvs()
})
