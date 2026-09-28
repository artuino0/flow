import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createEntityField, DuplicateFieldNameError, EntityNotFoundError, InvalidValidationRulesError } from '~/server/utils/moduleEntityFields'
import { KNOWN_DATA_TYPES } from '~/server/utils/dynamicSchema'

// POST /api/entities/:entity/fields { name, label, dataType, validationRules?, isRequired? } (HU-ERD-67)
// Sibling de fields.get.ts (HU-ERD-23): mismo ":entity", pero aca es el uuid
// de la entity (uso del admin dando de alta un campo), no el slug que espera
// el GET (uso del frontend consumidor). Solo Administrador (requireAdminRole).
//
// PUT/DELETE de un campo puntual NO viven aca anidados bajo /fields/:fieldId
// a proposito - ver el comentario largo en server/utils/moduleEntityFields.ts
// (bug real de enrutamiento de Nitro/rou3 con este anidado); viven en
// server/api/entity-fields/[fieldId].{put,delete}.ts.
const bodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .regex(/^[a-z][a-z0-9_]*$/, 'El nombre solo puede tener minusculas, numeros y guion bajo, y debe empezar con una letra (ej. "fecha_nacimiento")')
    // Reportado por el usuario (2026-09-01): "id" ya es el identificador
    // implicito de cada registro (uuid autogenerado, records.id) - no tiene
    // sentido dejar crear un campo propio con ese mismo nombre. Ver comentario
    // largo junto a ProtectedFieldError en moduleEntityFields.ts.
    .refine((v) => v !== 'id', '"id" es un nombre reservado: el identificador del registro ya existe automaticamente'),
  label: z.string().trim().min(1, 'La etiqueta es obligatoria'),
  dataType: z.enum(KNOWN_DATA_TYPES),
  validationRules: z.record(z.any()).optional().default({}),
  isRequired: z.boolean().optional().default(false),
  isOwnerField: z.boolean().optional().default(false)
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const entityId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const field = await createEntityField(auth.tenantId, entityId, body)
    setResponseStatus(event, 201)
    return field
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: 'Modulo no encontrado' })
    }
    if (err instanceof DuplicateFieldNameError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof InvalidValidationRulesError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
