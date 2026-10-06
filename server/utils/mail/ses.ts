import nodemailer from 'nodemailer'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { addresses, MailError, mailTimeout, type MailTransport } from './types'
export function sesTransport(region = process.env.SES_REGION, client?: Pick<SESv2Client, 'send'>): MailTransport {
  return {
    name: 'ses',
    async check() { return region && (client || (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI || process.env.AWS_WEB_IDENTITY_TOKEN_FILE)
      ? { status: 'ok' } : { status: 'misconfigured', reason: 'Falta SES_REGION y una identidad IAM de AWS.' } },
    async send(message) {
      if (!region) throw new MailError('Falta SES_REGION.', false)
      const sender = client ?? new SESv2Client({ region, maxAttempts: 1 })
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const delivery = async () => {
        const mime = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail({ ...message,
          ...(message.jobId ? { messageId: `<${message.jobId}@flow.mail>` } : {}) })
        const result = await sender.send(new SendEmailCommand({ FromEmailAddress: message.from,
          Destination: { ToAddresses: addresses(message.to), CcAddresses: message.cc, BccAddresses: message.bcc },
          Content: { Raw: { Data: mime.message as Buffer } }, TenantName: message.headers?.['X-SES-TENANT'], ConfigurationSetName: message.headers?.['X-SES-CONFIGURATION-SET']
        }), { abortSignal: controller.signal })
        if (!result.MessageId) throw new MailError('ses: respuesta de aceptación inválida.', false, true)
        return { id: result.MessageId }
        }
        return await Promise.race([delivery(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new MailError('ses: tiempo total de espera agotado.', true, true)) }, mailTimeout())
        })])
      } catch (error) {
        if (error instanceof MailError) throw error
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        throw new MailError(`ses: ${controller.signal.aborted ? 'tiempo de espera agotado' : status ? `rechazo HTTP ${status}` : 'error de conexión'}.`, !status || status >= 500 || status === 429, !status)
      } finally { if (timer) clearTimeout(timer); if (!client && sender instanceof SESv2Client) sender.destroy() }
    }
  }
}
