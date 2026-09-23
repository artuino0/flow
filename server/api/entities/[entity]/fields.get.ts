import { eq } from 'drizzle-orm'
import { requirePermission, getPermissionFlags } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields, tenants } from '~/server/db/schema'
import { computeInverseRelations, resolveDetailLayout } from '~/server/utils/detailLayout'
import { resolveListLayout } from '~/server/utils/listLayout'
import { isListFilterable } from '~/utils/listFilters'
import { resolveBoardConfig } from '~/server/utils/boardConfig'

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
      // "El organizador" (pedido del usuario, 2026-09-01) - mismo criterio de
      // orden que listEntityFields() (server/utils/moduleEntityFields.ts):
      // sortOrder primero, createdAt como desempate estable. Esta es la
      // fuente real que consumen ModuleFieldsCard.vue (el editor en si),
      // DynamicForm.vue (formulario real de crear/editar) y ModulePreviewCard.vue
      // (vista previa) - reordenar cambia el orden en los tres lugares a la
      // vez, no solo en el editor.
      .orderBy(entityFields.sortOrder, entityFields.createdAt)
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
  // son todos los campos cuyo tipo tiene un control y operadores definidos en
  // utils/listFilters.ts. Los campos de presentación (archivo, tabla, JSON)
  // no se ofrecen porque no tienen una comparación útil en el listado.
  const filterableFieldNames = fields.filter((f) => isListFilterable(f.dataType)).map((f) => f.name)
  const listLayout = resolveListLayout(entity.listLayout, fields.map((f) => f.name), filterableFieldNames)
  const boardConfig = resolveBoardConfig(entity.boardConfig, fields)

  // Reportado por el usuario (2026-09-03, "en el array de campos siempre debe
  // existir el id... no lo podiamos eliminar... debia ser un UUID"): el
  // Paso 2 "Campos" del asistente arrancaba en 0 campos para un modulo nuevo,
  // sin ningun rastro del identificador. records.id YA es un UUID
  // autogenerado por Postgres para todo record (ver comentario en
  // server/db/schema.ts) - no es un campo real de entity_fields ni vive en
  // custom_data, asi que agregarlo como fila real ahi contaminaria el schema
  // Zod dinamico (dynamicSchema.ts), los defaults de Diseño del
  // detalle/listado (detailLayout.ts/listLayout.ts) y la deteccion de "campo
  // de etiqueta" para relaciones (csvImport.ts, que hubiera elegido "id" por
  // ser el primer campo de tipo texto). Se sintetiza SOLO aca, al final,
  // despues de resolver detailLayout/listLayout con los campos reales (sin
  // "id") - ModuleFieldsCard.vue ya sabia mostrar name==='id' como
  // "Automático"/"Reservado" sin editar/eliminar (bloqueado tambien server-side
  // en moduleEntityFields.ts) desde que se reporto este mismo problema por
  // primera vez, pero nunca llegaba a aparecer en la lista. Ver tambien el
  // filtro `f.name !== 'id'` en ModulePreviewCard.vue y DynamicForm.vue: el
  // formulario REAL de crear/editar un registro nunca debe pedir el id a
  // mano.
  const idField = {
    id: 'system:id',
    name: 'id',
    label: 'ID',
    dataType: 'text',
    validationRules: {},
    isRequired: false
  }

  const [tenant] = await withTenant(auth.tenantId, (tx) => tx.select({ defaultCurrency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1))
  const responseFields = fields.map((field) => field.dataType === 'currency'
    ? {
        ...field,
        validationRules: {
          ...((field.validationRules ?? {}) as Record<string, unknown>),
          resolvedCurrency: (field.validationRules as Record<string, unknown> | null)?.currency === 'tenant'
            ? (tenant?.defaultCurrency ?? 'MXN')
            : ((field.validationRules as Record<string, unknown> | null)?.currency ?? 'MXN')
        }
      }
    : field)

  return { entity, fields: [idField, ...responseFields], permissions, inverseRelations, detailLayout, listLayout, boardConfig }
})
