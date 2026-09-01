import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { listRelationDefinitions } from '~/server/utils/relationDefinitions'

// GET /api/relation-definitions?entityId=... (HU-ERD-77)
// Admin-only, igual que la administracion de modulos (moduleEntities.ts) -
// definir que TIPOS de relacion existen es configuracion de la plataforma.
// `entityId` es opcional: sin el, lista todas las relation_definitions del
// tenant; con el, solo las que involucran esa entidad (pestaña "Relaciones"
// de Editar Módulo).
const querySchema = z.object({ entityId: z.string().uuid().optional() })

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  return listRelationDefinitions(auth.tenantId, query.entityId)
})
