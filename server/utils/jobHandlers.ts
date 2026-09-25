import { emailJobSchema, registerJobHandler, type ClaimedJob, type JobOutcome } from '~/server/utils/jobQueue'
import { sendPlainEmail, SmtpNotConfiguredError } from '~/server/utils/mailer'

/**
 * ¿Un error de envío merece reintento? Las direcciones inválidas y la mala
 * configuración no se arreglan solas (quedan en "dead", visibles para el
 * administrador). Los errores de red, los tiempos de espera y los 4xx
 * (límite de envío, servidor ocupado) sí se reintentan con retroceso.
 */
export function classifyEmailError(error: unknown): JobOutcome {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof SmtpNotConfiguredError) return { ok: false, retryable: false, error: message }
  const { responseCode, code } = (error ?? {}) as { responseCode?: number; code?: string }
  if (code === 'EAUTH') return { ok: false, retryable: false, error: `Credenciales de correo rechazadas: ${message}` }
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) return { ok: false, retryable: false, error: message }
  return { ok: false, retryable: true, error: message }
}

export async function handleEmailJob(job: ClaimedJob): Promise<JobOutcome> {
  const parsed = emailJobSchema.safeParse(job.payload)
  if (!parsed.success) return { ok: false, retryable: false, error: 'El contenido del correo en la cola es inválido' }
  try {
    await sendPlainEmail({ tenantId: job.tenantId, ...parsed.data })
    return { ok: true }
  } catch (error) {
    return classifyEmailError(error)
  }
}

let registered = false
/** Registra los manejadores de cada tipo de trabajo (idempotente). */
export function registerDefaultJobHandlers(): void {
  if (registered) return
  registerJobHandler('email', handleEmailJob)
  registered = true
}
