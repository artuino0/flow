import { enqueueEmail, type EmailJobPayload } from '~/server/utils/jobQueue'
import { db } from '~/server/db'
import { jobQueue } from '~/server/db/schema'
import { emailJobSchema, type emailQuota } from '~/server/utils/jobQueue'

/** La operación de negocio y el correo pendiente se confirman juntos. */
export async function enqueueCriticalEmailInTx(tx: typeof db, tenantId: string | null, payload: EmailJobPayload, quota?: Awaited<ReturnType<typeof emailQuota>>) {
  const parsed = emailJobSchema.parse(payload)
  if (tenantId === null && (!parsed.platform || parsed.purpose !== 'registration' || !parsed.pendingRegistrationId || !parsed.encryptedHtml)) throw new Error('Correo provisional sin alcance válido')
  const limit = quota?.usage.usage.find(item => item.concept === 'emails')
  const [row] = await tx.insert(jobQueue).values({ tenantId, kind: 'email', payload: parsed,
    status: quota?.exceeded ? 'dead' : 'pending', lastError: quota?.exceeded ? `Límite del plan ${quota.usage.plan}: se excedió la cuota mensual de correos (${limit!.limit}).` : null,
    completedAt: quota?.exceeded ? new Date() : null }).returning({ id: jobQueue.id })
  return { id: row!.id, payload: parsed }
}

/** Compatibilidad con los llamadores de Agenda: la fila ya está pendiente. */
export async function sendQueuedCriticalEmail(tenantId: string, id: string, _payload: EmailJobPayload) {
  // La fila ya fue confirmada en la operación de negocio. Solo el worker envía.
  return { tenantId, id, queued: true }
}

/** Acepta en cola; las peticiones de negocio nunca esperan al transporte. */
export async function sendCriticalEmail(tenantId: string, payload: EmailJobPayload): Promise<void> {
  await enqueueEmail(tenantId, payload)
}
