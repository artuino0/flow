import { sql } from 'drizzle-orm'
import { db } from '~/server/db'

export const DEFAULT_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

export class StorageLimitExceededError extends Error {
  constructor(public readonly limitBytes: number, public readonly usedBytes: number) {
    super('Se alcanzó el límite de almacenamiento de este espacio de trabajo')
  }
}

type StorageRow = { storage_used_bytes: string | number; storage_limit_bytes: string | number }
function asNumber(value: string | number) { return typeof value === 'number' ? value : Number(value) }

/** Reserva bytes de forma atómica antes de subir un objeto. */
export async function reserveStorage(tenantId: string, bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('El tamaño del archivo no es válido')
  const rows = await db.execute(sql`
    UPDATE tenants
    SET storage_used_bytes = storage_used_bytes + ${bytes}, updated_at = now()
    WHERE id = ${tenantId}::uuid
      AND storage_used_bytes + ${bytes} <= storage_limit_bytes
    RETURNING storage_used_bytes, storage_limit_bytes
  `) as unknown as StorageRow[]
  const row = rows[0]
  if (row) return { usedBytes: asNumber(row.storage_used_bytes), limitBytes: asNumber(row.storage_limit_bytes) }

  const usage = await getStorageUsage(tenantId)
  throw new StorageLimitExceededError(usage.limitBytes, usage.usedBytes)
}

/** Libera bytes al borrar o reemplazar un objeto. Nunca deja el contador negativo. */
export async function releaseStorage(tenantId: string, bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return
  await db.execute(sql`
    UPDATE tenants
    SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${bytes}), updated_at = now()
    WHERE id = ${tenantId}::uuid
  `)
}

export async function getStorageUsage(tenantId: string) {
  const rows = await db.execute(sql`
    SELECT storage_used_bytes, storage_limit_bytes
    FROM tenants
    WHERE id = ${tenantId}::uuid
    LIMIT 1
  `) as unknown as StorageRow[]
  const row = rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Espacio de trabajo no encontrado' })
  const usedBytes = asNumber(row.storage_used_bytes)
  const limitBytes = asNumber(row.storage_limit_bytes)
  return { usedBytes, limitBytes, availableBytes: Math.max(0, limitBytes - usedBytes), percentUsed: limitBytes ? Math.min(100, Math.round((usedBytes / limitBytes) * 1000) / 10) : 0 }
}
