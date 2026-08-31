import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { updateEntityField, InvalidValidationRulesError } from '~/server/utils/moduleEntityFields'
import { KNOWN_DATA_TYPES } from '~/server/utils/dynamicSchema'

// PUT /api/entity-fields/:fieldId { label?, dataType?, validationRules?, isRequired? } (HU-ERD-67)
// Recurso plano (no anidado bajo /api/entities/:entity/fields/:fieldId) -
// ver el comentario largo en server/utils/moduleEntityFields.ts: el
// anidado se probo primero y encontro un bug real de enrutamiento en
// Nitro/rou3. fieldId ya es un uuid globalmente unico; moduleEntityFields.ts
// resuelve la entity dueña (y valida que sea del tenant autenticado) por
// join, sin necesitar el entityId en la URL.
//
// "name" NO se puede editar aca a proposito - es la clave que usa el campo
// dentro de records.custom_data (JSONB); renombrarlo dejaria huerfanos los
// datos ya cargados bajo la clave vieja sin ninguna migracion, mismo criterio
// que el slug inmutable de entities (HU-ERD-66).
//
// Si el update cambia dataType/validationRules/isRequired,
// moduleEntityFields.ts escribe un snapshot en entity_field_history ANTES de
// aplicar el cambio - ver ese archivo para el porque. El marcado de
// records.is_dirty ya lo hace un trigger de Postgres (migracion 0011,
// ERD-18), no este endpoint.
const bodySchema = z.object({
  label: z.string().trim().min(1, 'La etiqueta es obligatoria').optional(),
  dataType: z.enum(KNOWN_DATA_TYPES).optional(),
  validationRules: z.record(z.any()).optional(),
  isRequired: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const fieldId = getRouterParam(event, 'fieldId')!
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const field = await updateEntityField(auth.tenantId, fieldId, body, auth.sub ?? null)
    if (!field) {
      throw createError({ statusCode: 404, statusMessage: 'Campo no encontrado' })
    }
    return field
  } catch (err) {
    if (err instanceof InvalidValidationRulesError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
