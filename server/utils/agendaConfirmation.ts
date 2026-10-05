import { and, eq, lte } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { agendaPublicBookings, records } from '~/server/db/schema'
import { withSystemRecordAccess } from './recordActorContext'
import { agendaSecurityEvent } from './agendaPersistentLimit'

/** Cron y lectura pública comparten la transición, bajo candado de fila. */
export async function expireAgendaConfirmations(tenant: string, now = Date.now(), recordId?: string) {
  const changed = await withSystemRecordAccess(() => withTenant(tenant, async tx => {
    const query = tx.select().from(agendaPublicBookings).where(and(eq(agendaPublicBookings.tenantId, tenant), eq(agendaPublicBookings.confirmationState, 'pending'), lte(agendaPublicBookings.confirmationExpiresAt, new Date(now)), recordId ? eq(agendaPublicBookings.recordId, recordId) : undefined)).limit(100)
    const pending = await (recordId ? query.for('update') : query.for('update', { skipLocked: true }))
    const result: Array<{ site: string; id: string; entity: string; data: Record<string, unknown> }> = []
    for (const booking of pending) {
      const [record] = await tx.select().from(records).where(and(eq(records.id, booking.recordId), eq(records.tenantId, tenant))).for('update')
      if (record && (record.customData as Record<string, unknown>).estado === 'por_confirmar') {
        const data = { ...record.customData as Record<string, unknown>, estado: 'cancelada' }
        await tx.update(records).set({ customData: data, updatedAt: new Date(now), isDirty: true }).where(eq(records.id, record.id))
        result.push({ site: booking.siteId, id: record.id, entity: record.entityId, data })
      }
      await tx.update(agendaPublicBookings).set({ status: 'canceled', confirmationState: 'expired', canceledAt: new Date(now) }).where(eq(agendaPublicBookings.id, booking.id))
    }
    return result
  }))
  for (const row of changed) {
    agendaSecurityEvent(row.site, 'confirmation_expired')
  }
  return changed.length
}
