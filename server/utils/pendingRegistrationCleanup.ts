import { sql } from 'drizzle-orm'
import { db } from '~/server/db'
/** Separada del ciclo de HU-191, ausente en esta rama. Activación explícita. */
export async function cleanupPendingRegistrations(days = Number(process.env.REGISTRATION_PENDING_DAYS || 7)) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('REGISTRATION_PENDING_DAYS debe estar entre 1 y 365')
  const rows = await db.execute(sql`select purge_pending_registrations(${days}) as removed`)
  return Number(rows[0]!.removed)
}
