import { eq } from 'drizzle-orm'
import { requirePermission, getPermissionFlags } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields } from '~/server/db/schema'

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

  return { entity, fields, permissions }
})
