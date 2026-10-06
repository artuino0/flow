import { emailJobSchema, registerJobHandler, type ClaimedJob, type JobOutcome } from '~/server/utils/jobQueue'
import { sendPlainEmail, SmtpNotConfiguredError } from '~/server/utils/mailer'
import { MailError } from './mail/types'
import { decryptSetting } from './settingsCrypto'
import { db, withJobWorker } from '~/server/db'
import { emailVerificationTokens, jobQueue, pendingRegistrations } from '~/server/db/schema'
import { eq } from 'drizzle-orm'

/**
 * ¿Un error de envío merece reintento? Las direcciones inválidas y la mala
 * configuración no se arreglan solas (quedan en "dead", visibles para el
 * administrador). Los errores de red, los tiempos de espera y los 4xx
 * (límite de envío, servidor ocupado) sí se reintentan con retroceso.
 */
export function classifyEmailError(error: unknown): JobOutcome {
  if (error instanceof MailError) return { ok: false, retryable: error.retryable && (!error.uncertain || error.safeReplay), error: error.message }
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof SmtpNotConfiguredError) return { ok: false, retryable: false, error: message }
  const { responseCode, code } = (error ?? {}) as { responseCode?: number; code?: string }
  if (code === 'EAUTH') return { ok: false, retryable: false, error: `Credenciales de correo rechazadas: ${message}` }
  if (/(?:too many emails? per second|rate limit|throttl)/i.test(message)) return { ok: false, retryable: true, error: message }
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) return { ok: false, retryable: false, error: message }
  return { ok: false, retryable: true, error: message }
}

export async function handleEmailJob(job: ClaimedJob): Promise<JobOutcome> {
  const parsed = emailJobSchema.safeParse(job.payload)
  if (!parsed.success) return { ok: false, retryable: false, error: 'El contenido del correo en la cola es inválido' }
  try {
    const [receipt] = await withJobWorker(tx => tx.select({ deliveryId: jobQueue.deliveryId, provider: jobQueue.deliveryProvider, startedAt: jobQueue.deliveryStartedAt }).from(jobQueue).where(eq(jobQueue.id, job.id)).limit(1))
    if (receipt?.deliveryId) return { ok: true }
    if (receipt?.startedAt && (receipt.provider !== 'resend' || receipt.startedAt.getTime() < Date.now() - 23 * 60 * 60 * 1000)) {
      return { ok: false, retryable: false, error: 'Resultado de entrega desconocido; comprueba el proveedor antes de reintentar para evitar duplicados.' }
    }
    if (parsed.data.verificationId) {
      const [verification] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.id, parsed.data.verificationId))
      if (!verification || verification.usedAt || !verification.codeExpiresAt || verification.codeExpiresAt <= new Date()) return { ok: true }
    }
    if (parsed.data.pendingRegistrationId) {
      const [pending] = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.id, parsed.data.pendingRegistrationId))
      if (!pending || pending.verifiedAt || pending.codeExpiresAt <= new Date() || pending.codeHash !== parsed.data.pendingCodeHash) return { ok: true }
    }
    await sendPlainEmail({ tenantId: job.tenantId ?? undefined, ...parsed.data, html: parsed.data.encryptedHtml ? decryptSetting(parsed.data.encryptedHtml) : parsed.data.html,
      jobId: job.id, fallback: job.attempts > 1 && !receipt?.startedAt, retryProvider: receipt?.startedAt ? receipt.provider ?? undefined : undefined })
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
  registerJobHandler('platform_crm', async job => (await import('./platformCrmQueue')).handlePlatformCrmJob(job))
  registerJobHandler('agenda_expire', async job => {
    if (typeof job.payload.recordId !== 'string') return { ok: false, retryable: false, error: 'Trabajo de expiración inválido' }
    if (!job.tenantId) return { ok: false, retryable: false, error: 'Trabajo sin organización inválido' }
    await (await import('./agendaConfirmation')).expireAgendaConfirmations(job.tenantId, Date.now(), job.payload.recordId)
    return { ok: true }
  })
  registered = true
}
