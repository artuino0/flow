export interface MailAttachment { filename: string; content: Buffer; contentType?: string; cid?: string }
export interface MailMessage {
  from: string; to: string | string[]; cc?: string[]; bcc?: string[]; replyTo?: string
  subject: string; html: string; text?: string; headers?: Record<string, string>
  attachments?: MailAttachment[]; jobId?: string
}
export interface MailStatus { status: 'ok' | 'misconfigured'; reason?: string }
export interface MailTransport { name: string; send(message: MailMessage): Promise<{ id: string }>; check(): Promise<MailStatus> }
export class MailError extends Error {
  constructor(message: string, public retryable: boolean, public uncertain = false, public safeReplay = false) { super(message) }
}
export const mailTimeout = () => {
  const ms = Number(process.env.MAIL_TIMEOUT_MS ?? 10000)
  return Number.isInteger(ms) && ms >= 100 && ms <= 30000 ? ms : 10000
}
export function senderStatus(from: string): MailStatus {
  return !from || /[\r\n]/.test(from) || !/[^\s<>]+@[^\s<>]+\.[^\s<>]+/.test(from) || /@(?:[^>\s]*\.)?(?:example\.(?:com|net|org)|tu-dominio\.com)(?:[>\s]|$)/i.test(from)
    ? { status: 'misconfigured', reason: 'Configura MAIL_FROM con un remitente de un dominio verificado, sin marcadores.' } : { status: 'ok' }
}
export function addresses(value: string | string[] | undefined): string[] { return value ? Array.isArray(value) ? value : [value] : [] }
export function address(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/)
  return { email: match?.[2] ?? value, ...(match?.[1] ? { name: match[1].replace(/^"|"$/g, '') } : {}) }
}
