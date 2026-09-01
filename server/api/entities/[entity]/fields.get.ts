import { eq } from 'drizzle-orm'
import { requirePermission, getPermissionFlags } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields } from '~/server/db/schema'
import { computeInverseRelations, resolveDetailLayout } from '~/server/utils/detailLayout'
import { resolveListLayout } from '~/server/utils/listLayout'

// GET /api/entities/:entity/fields (HU-ERD-23)
//
// No existe todavia un ticket dedicado a exponer entity_fields al frontend
// (ERD-43 solo cubre el listado de entidades para el menu, sin sus campos).
// El Form Builder (y luego el Table Builder, ERD-24) necesitan esta forma
// minima para saber que inputs renderizar y con que reglas - se agrega aca,
// como prerequisito de ERD-23, en vez de inventar un tipo de dato paralelo
// o hardcodear formularios por entidad.
//
// Mismo gate que records (canRead sobre la entidad): si puedes leer registros,
// puedes leer la forma de sus campos.
export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')

  const fields = await withTenant(auth.tenantId, async (tx) =>
    tx
      .select({
        id: entityFields.id,
        name: entityFields.name,
        label: entityFields.label,
        dataType: entityFields.dataType,
        validationRules: entityFields.validationRules,
        isRequired: entityFields.isRequired
      })
      .from(entityFields)
      .where(eq(entityFields.entityId, entity.id))
      .orderBy(entityFields.createdAt)
  )

  // HU-ERD-24: se agregan los 4 flags de permiso ademas de canRead (ya
  // implicito en que la request paso requirePermission) para que el Table
  // Builder decida que acciones mostrar (Nuevo/Editar/Eliminar) por fila.
  const permissions = await getPermissionFlags(auth, entity.id)

  // HU-ERD-74: resuelto aca (no solo devuelto crudo) para que tanto la ficha
  // de detalle real (pages/registros/:entity/:id/index.vue) como el
  // configurador (pages/modulos/:id/editar.vue, paso "Diseño del detalle")
  // lean SIEMPRE el mismo layout ya reconciliado contra los campos/relaciones
  // reales de hoy - un solo lugar que decide el default, no dos copias que
  // puedan divergir.
  const inverseRelations = await withTenant(auth.tenantId, (tx) => computeInverseRelations(tx, auth.tenantId, entity.slug))
  const detailLayout = resolveDetailLayout(entity.detailLayout, fields.map((f) => f.name), inverseRelations)

  // HU-ERD-75: mismo criterio - resuelto aca para que el listado real
  // (pages/registros/:entity/index.vue) y el configurador (paso "Diseño del
  // listado") lean siempre el mismo layout ya reconciliado. Los "filtrables"
  // son exactamente los campos Select/Multiselect (unicos con un operador de
  // filtro real hoy, HU-ERD-73) - filterFields de listLayout nunca puede
  // exceder este conjunto (criterio de aceptacion explicito de la HU).
  const filterableFieldNames = fields.filter((f) => f.dataType === 'select' || f.dataType === 'multiselect').map((f) => f.name)
  const listLayout = resolveListLayout(entity.listLayout, fields.map((f) => f.name), filterableFieldNames)

  return { entity, fields, permissions, inverseRelations, detailLayout, listLayout }
})
