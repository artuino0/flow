import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { revalidateIfDirty } from '~/server/utils/lazyRevalidation'
import { withTenant } from '~/server/db'
import { records, entityFields } from '~/server/db/schema'
import { resolveRelationLabels } from '~/server/utils/relationLabels'
import { recordNotDeleted } from '~/server/utils/records'

// GET /api/records/:entity/:id (HU-ERD-16)
export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')

  const result = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(records)
      // ERD-87: un registro eliminado responde 404, igual que si no existiera -
      // la ficha de detalle es uso normal, no la papelera.
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted))
      .limit(1)
    if (!r) return null
    // HU-ERD-18: revalidacion perezosa en el proximo acceso al registro.
    const row = await revalidateIfDirty(tx, r)

    // Reportado por el usuario (2026-09-03): mismo criterio que el listado
    // (ver server/utils/relationLabels.ts) - la ficha de detalle tambien
    // mostraba el uuid crudo en las propiedades de tipo relation.
    const sourceFields = await tx
      .select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields)
      .where(eq(entityFields.entityId, entity.id))
    const relationLabels = await resolveRelationLabels(tx, auth.tenantId, sourceFields, [row])

    return { row, relationLabels }
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }
  return { ...result.row, relationLabels: result.relationLabels }
})
