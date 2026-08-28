import { eq } from 'drizzle-orm'
import type { db } from '~/server/db'
import { records } from '~/server/db/schema'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'

// HU-ERD-18: revalidacion perezosa. El trigger de la migracion 0011
// (fn_mark_records_dirty_on_field_change) marca records.is_dirty = true
// cuando cambian los entity_fields de su entidad, sin revalidar nada de
// inmediato. La revalidacion real ocurre aca, bajo demanda, en el proximo
// acceso (GET) o edicion (PUT) de cada registro afectado. No hay job masivo.

type Tx = typeof db

interface DirtyableRecord {
  id: string
  entityId: string
  tenantId: string
  customData: unknown
  isDirty: boolean
}

/**
 * Si el registro esta limpio, lo devuelve tal cual (sin costo extra).
 * Si esta sucio, lo revalida contra el schema Zod dinamico vigente de su
 * entidad (ERD-17): si vuelve a ser valido, limpia is_dirty en la misma
 * transaccion; si sigue siendo invalido (p. ej. le falta un campo que ahora
 * es requerido), lo deja marcado dirty y devuelve el dato existente sin
 * bloquear la lectura — el usuario lo corrige al editarlo.
 */
export async function revalidateIfDirty<T extends DirtyableRecord>(tx: Tx, row: T): Promise<T> {
  if (!row.isDirty) return row

  const schema = await getEntityZodSchema(row.tenantId, row.entityId)
  const parsed = schema.safeParse(row.customData)
  if (!parsed.success) {
    return row
  }

  const [updated] = await tx
    .update(records)
    .set({ isDirty: false })
    .where(eq(records.id, row.id))
    .returning()
  return (updated as T) ?? row
}
