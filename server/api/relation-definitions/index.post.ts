import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createRelationDefinition, DuplicateRelationNameError, RelationEntityNotFoundError } from '~/server/utils/relationDefinitions'

// POST /api/relation-definitions { name, sourceEntityId, targetEntityId } (HU-ERD-77)
// Crea un TIPO de relacion (ej. "Recepcion pertenece a Productor") - la
// creacion de VINCULOS entre dos records puntuales sigue siendo
// POST /api/relations (HU-ERD-19), sin cambios.
const bodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const definition = await createRelationDefinition(auth.tenantId, body)
    setResponseStatus(event, 201)
    return definition
  } catch (err) {
    if (err instanceof DuplicateRelationNameError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof RelationEntityNotFoundError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
