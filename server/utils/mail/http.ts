import { MailError, mailTimeout, type MailMessage, type MailTransport } from './types'

export function httpTransport(name: string, endpoint: string, credential: string | undefined, auth: (key: string) => Record<string, string>,
  body: (message: MailMessage) => unknown, result: (value: Record<string, unknown>) => string | undefined): MailTransport {
  return {
    name,
    async check() { return credential ? { status: 'ok' } : { status: 'misconfigured', reason: `Faltan las credenciales de ${name}.` } },
    async send(message) {
      if (!credential) throw new MailError(`Faltan las credenciales de ${name}.`, false)
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), mailTimeout())
      try {
        const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...auth(credential),
          ...(name === 'resend' && message.jobId ? { 'Idempotency-Key': message.jobId } : {}) }, body: JSON.stringify(body(message)) })
        if (!response.ok) throw new MailError(`${name}: rechazo HTTP ${response.status}.`, response.status >= 500 || response.status === 429 || response.status === 408)
        const value: unknown = await response.json()
        const id = value && typeof value === 'object' ? result(value as Record<string, unknown>) : undefined
        if (!id) throw new MailError(`${name}: respuesta de aceptación inválida.`, name === 'resend' && Boolean(message.jobId), true, name === 'resend' && Boolean(message.jobId))
        return { id }
      } catch (error) {
        if (error instanceof MailError) throw error
        // Sin ACK no se sabe si aceptó: nunca cambiar de proveedor a ciegas.
        const connectionCode = (error as { cause?: { code?: string } }).cause?.code
        throw new MailError(`${name}: ${controller.signal.aborted ? 'tiempo de espera agotado' : 'error de conexión o respuesta'}.`, true, !['ECONNREFUSED', 'ENOTFOUND'].includes(connectionCode ?? ''), name === 'resend' && Boolean(message.jobId))
      } finally { clearTimeout(timer) }
    }
  }
}
