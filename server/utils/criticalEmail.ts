import { completeJob, failJob, reserveImmediateEmail, type EmailJobPayload } from '~/server/utils/jobQueue'
import { classifyEmailError } from '~/server/utils/jobHandlers'
import { sendPlainEmail } from '~/server/utils/mailer'

/** Envía ahora y deja la misma fila para reintento si SMTP falla. */
export async function sendCriticalEmail(tenantId: string, payload: EmailJobPayload): Promise<void> {
  const id = await reserveImmediateEmail(tenantId, payload)
  if (!id) return // Límite del plan: la fila dead ya explica el rechazo.
  try {
    await sendPlainEmail({ tenantId, ...payload })
  } catch (error) {
    await failJob({ id, attempts: 1, maxAttempts: 6 }, classifyEmailError(error))
    return
  }
  await completeJob(id)
}
