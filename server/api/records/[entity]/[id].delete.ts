import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { recordNotDeleted } from '~/server/utils/records'

// DELETE /api/records/:entity/:id (HU-ERD-16)
// ERD-87: borrado LOGICO, no fisico - antes de esta HU esto era un
// `tx.delete(records)` real. El Diseñador de reportes imprimibles (ERD-88)
// necesita poder mostrar registros eliminados como filas atenuadas junto a
// los activos (visto en un reporte real de otro ERP: UNION ALL contra una
// tabla "_eliminado"), algo imposible de reconstruir despues de un borrado
// fisico. Se filtra recordNotDeleted en el WHERE para que "eliminar" un
// registro ya eliminado responda 404 en vez de pisar deletedAt en silencio.
export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canDelete')

  const row = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .update(records)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted))
      .returning()
    return r
  })

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }

  // HU-ERD-48: mismo criterio "fire-and-forget" que create/update - el
  // customData evaluado es el del record YA borrado (la unica version que
  // existe en este punto).
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_delete', row.id, row.customData as Record<string, unknown>)

  return { deleted: true, id: row.id }
})
