import nodemailer from 'nodemailer'
import { MailError, mailTimeout, type MailTransport } from './types'
export interface SmtpOptions { host: string; port: number; user?: string; password?: string; security?: 'tls' | 'ssl' | 'none'; headers?: Record<string, string> }
export function smtpTransport(config: SmtpOptions): MailTransport {
  return {
    name: 'smtp',
    async check() { return config.host && Number.isInteger(config.port) && config.port > 0 && config.port <= 65535 && Boolean(config.user) === Boolean(config.password)
      ? { status: 'ok' } : { status: 'misconfigured', reason: 'Configuración SMTP incompleta o inválida.' } },
    async send(message) {
      const timeout = mailTimeout()
      const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.security === 'ssl' || (!config.security && config.port === 465),
        requireTLS: config.security === 'tls', connectionTimeout: Math.floor(timeout * 0.8), greetingTimeout: Math.floor(timeout * 0.8), socketTimeout: timeout,
        ...(config.user && config.password ? { auth: { user: config.user, pass: config.password } } : {}) })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([transport.sendMail({ ...message, headers: { ...config.headers, ...message.headers },
          ...(message.jobId ? { messageId: `<${message.jobId}@flow.mail>` } : {}) }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { transport.close(); reject(new MailError('smtp: tiempo total de espera agotado.', true, true)) }, timeout)
        })])
        if (!result.messageId || result.accepted?.length === 0) throw new MailError('smtp: mensaje rechazado.', false)
        return { id: String(result.messageId) }
      } catch (error) {
        if (error instanceof MailError) throw error
        const e = error as { responseCode?: number; code?: string; command?: string }
        throw new MailError(`smtp: ${e.code === 'EAUTH' ? 'credenciales rechazadas' : e.responseCode ? `rechazo ${e.responseCode}` : 'error de conexión'}.`,
          e.code !== 'EAUTH' && !(e.responseCode && e.responseCode >= 500), !e.responseCode && e.command !== 'CONN' && !['ECONNREFUSED', 'ENOTFOUND'].includes(e.code ?? ''))
      } finally { if (timer) clearTimeout(timer); transport.close() }
    }
  }
}
