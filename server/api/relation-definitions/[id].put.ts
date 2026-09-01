import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { updateRelationDefinition, DuplicateRelationNameError } from '~/server/utils/relationDefinitions'

// PUT /api/relation-definitions/:id { name } (HU-ERD-77)
// Solo permite renombrar - ver el comentario largo en
// server/utils/relationDefinitions.ts (updateRelationDefinition) sobre por
// que sourceEntityId/targetEntityId no son editables despues de creada.
const bodySchema = z.object({ name: z.string().trim().min(1, 'El nombre es obligatorio') })

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  let definition
  try {
    definition = await updateRelationDefinition(auth.tenantId, id, body)
  } catch (err) {
    if (err instanceof DuplicateRelationNameError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    throw err
  }

  if (!definition) {
    throw createError({ statusCode: 404, statusMessage: 'Relacion no encontrada' })
  }
  return definition
})
