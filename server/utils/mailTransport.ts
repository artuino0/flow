import { eq, sql } from 'drizzle-orm'
import { withTenant, withJobWorker } from '~/server/db'
import { tenantEmailSettings, jobQueue } from '~/server/db/schema'
import { decryptSetting } from './settingsCrypto'
import { smtpTransport } from './mail/smtp'
import { sesTransport } from './mail/ses'
import { mailtrapTransport } from './mail/mailtrap'
import { resendTransport } from './mail/resend'
import { postmarkTransport } from './mail/postmark'
import { MailError, senderStatus, type MailMessage, type MailTransport } from './mail/types'
import { logger } from './logger'

export function platformFrom() { return (process.env.MAIL_FROM || process.env.SMTP_FROM || '').replace(/^FlowERP(?=\s*<)/, 'Flow') }
export function makeMailTransport(name = process.env.MAIL_PROVIDER || 'smtp'): MailTransport {
  switch (name) {
    case 'smtp': return smtpTransport({ host: process.env.SMTP_HOST ?? '', port: Number(process.env.SMTP_PORT), user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD,
      security: Number(process.env.SMTP_PORT) === 465 ? 'ssl' : process.env.SMTP_USER ? 'tls' : 'none' })
    case 'ses': return sesTransport()
    case 'mailtrap': return mailtrapTransport()
    case 'resend': return resendTransport()
    case 'postmark': return postmarkTransport()
    default: return { name, async check() { return { status: 'misconfigured', reason: 'MAIL_PROVIDER no es válido.' } }, async send() { throw new MailError('MAIL_PROVIDER no es válido.', false) } }
  }
}
export async function platformMailStatus() {
  const transport = makeMailTransport(), from = platformFrom()
  const status = senderStatus(from).status === 'ok' ? await transport.check() : senderStatus(from)
  return { ...status, provider: transport.name, from }
}
export async function resolveMailTransport(tenantId?: string) {
  if (tenantId) {
    const [row] = await withTenant(tenantId, tx => tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, tenantId)).limit(1))
    if (row) {
      const from = row.fromName ? `"${row.fromName.replace(/"/g, '')}" <${row.fromEmail}>` : row.fromEmail
      if (row.provider === 'ses') {
        if (!row.sesTenantName || !row.sesConfigSet || row.domainStatus !== 'verified' || row.sendingStatus === 'paused') throw new MailError('El dominio SES de esta organización no está verificado o su envío está pausado.', false)
        return { transport: sesTransport(), from, replyTo: row.replyTo ?? undefined, headers: { 'X-SES-TENANT': row.sesTenantName, 'X-SES-CONFIGURATION-SET': row.sesConfigSet }, platform: false }
      }
      if (row.provider !== 'smtp' || !row.host || !row.port || !row.username || !row.passwordEncrypted) throw new MailError('La configuración de correo de esta organización está incompleta.', false)
      return { transport: smtpTransport({ host: row.host, port: row.port, user: row.username, password: decryptSetting(row.passwordEncrypted), security: (row.security as 'tls' | 'ssl' | 'none') || 'tls' }),
        from, replyTo: row.replyTo ?? undefined, headers: undefined, platform: false }
    }
  }
  return { transport: makeMailTransport(), from: platformFrom(), replyTo: undefined, headers: undefined, platform: true }
}
// Diagnóstico de proceso sin PII. La cola conserva estado durable por trabajo.
export const mailDiagnostics: { lastSuccess: { provider: string; at: string; durationMs: number } | null; lastFailure: { provider: string; at: string; durationMs: number; reason: string } | null } = { lastSuccess: null, lastFailure: null }
export async function deliverMail(message: Omit<MailMessage, 'from'>, tenantId?: string, platform = false, fallback = false, retryProvider?: string) {
  const resolved = await resolveMailTransport(platform ? undefined : tenantId)
  const transport = retryProvider && resolved.platform ? makeMailTransport(retryProvider)
    : fallback && resolved.platform && process.env.MAIL_FALLBACK_PROVIDER ? makeMailTransport(process.env.MAIL_FALLBACK_PROVIDER) : resolved.transport
  const started = Date.now()
  let accepted = false
  try {
    if (retryProvider && !resolved.platform) throw new MailError('Cambió la configuración de la organización durante una entrega incierta. Comprueba el proveedor antes de reintentar.', false, true)
    const sender = resolved.platform ? senderStatus(resolved.from) : { status: 'ok' as const, reason: undefined }, config = await transport.check()
    if (sender.status !== 'ok' || config.status !== 'ok') throw new MailError(sender.reason ?? config.reason ?? 'Correo sin configurar.', false)
    if (message.jobId) await withJobWorker(tx => tx.update(jobQueue).set({ deliveryProvider: transport.name, deliveryStartedAt: sql`coalesce(${jobQueue.deliveryStartedAt}, now())` }).where(eq(jobQueue.id, message.jobId!)))
    const result = await transport.send({ ...message, from: resolved.from, replyTo: message.replyTo ?? resolved.replyTo, headers: { ...resolved.headers, ...message.headers } })
    accepted = true
    if (message.jobId) await withJobWorker(tx => tx.update(jobQueue).set({ deliveryProvider: transport.name, deliveryId: result.id }).where(eq(jobQueue.id, message.jobId!)))
    mailDiagnostics.lastSuccess = { provider: transport.name, at: new Date().toISOString(), durationMs: Date.now() - started }
    logger.info('mail_delivered', { provider: transport.name, durationMs: Date.now() - started })
    return { ...result, provider: transport.name, durationMs: Date.now() - started }
  } catch (error) {
    if (accepted) throw new MailError('Correo aceptado; no se pudo guardar la confirmación. Requiere revisar la entrega antes de reintentar.', false, true)
    if (message.jobId && !retryProvider && error instanceof MailError && !error.uncertain) await withJobWorker(tx => tx.update(jobQueue).set({ deliveryStartedAt: null }).where(eq(jobQueue.id, message.jobId!)))
    const reason = error instanceof MailError ? error.message : 'No se pudo entregar el correo.'
    mailDiagnostics.lastFailure = { provider: transport.name, at: new Date().toISOString(), durationMs: Date.now() - started, reason }
    logger.warn('mail_failed', { provider: transport.name, durationMs: Date.now() - started, reason })
    throw error
  }
}
