import { completeJob, failJob, reserveImmediateEmail, type EmailJobPayload } from '~/server/utils/jobQueue'
import { classifyEmailError } from '~/server/utils/jobHandlers'
import { sendPlainEmail } from '~/server/utils/mailer'
import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { jobQueue } from '~/server/db/schema'
import { emailJobSchema, type emailQuota } from '~/server/utils/jobQueue'

/** La operación de negocio y el correo pendiente se confirman juntos. */
export async function enqueueCriticalEmailInTx(tx: typeof db, tenantId: string, payload: EmailJobPayload, quota: Awaited<ReturnType<typeof emailQuota>>) {
  const parsed = emailJobSchema.parse(payload)
  const limit = quota.usage.usage.find(item => item.concept === 'emails')!
  const [row] = await tx.insert(jobQueue).values({ tenantId, kind: 'email', payload: parsed,
    status: quota.exceeded ? 'dead' : 'pending', lastError: quota.exceeded ? `Límite del plan ${quota.usage.plan}: se excedió la cuota mensual de correos (${limit.limit}).` : null,
    completedAt: quota.exceeded ? new Date() : null }).returning({ id: jobQueue.id })
  return { id: row!.id, payload: parsed }
}

/** Compite con el worker por la misma fila; nunca crea una segunda. */
export async function sendQueuedCriticalEmail(tenantId: string, id: string, payload: EmailJobPayload) {
  const [claimed] = await withTenant(tenantId, tx => tx.update(jobQueue).set({ status: 'processing', attempts: 1, lockedAt: new Date(), lockedBy: 'immediate' })
    .where(and(eq(jobQueue.id, id), eq(jobQueue.tenantId, tenantId), eq(jobQueue.status, 'pending'))).returning({ id: jobQueue.id }))
  if (!claimed) return
  try { await sendPlainEmail({ tenantId, ...payload }) } catch (error) {
    await failJob({ id, attempts: 1, maxAttempts: 6 }, classifyEmailError(error))
    return
  }
  await completeJob(id)
}

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
