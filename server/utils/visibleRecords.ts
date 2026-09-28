import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/db'
import { records } from '~/server/db/schema'

export async function assertVisibleRecords(tx: typeof db, tenantId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]
  const found = await tx.select({ id: records.id }).from(records)
    .where(and(eq(records.tenantId, tenantId), inArray(records.id, unique), isNull(records.deletedAt)))
  if (found.length !== unique.length) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
}
