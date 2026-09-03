import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { listTriggers } from '~/server/utils/triggerAdmin'

// GET /api/triggers?entityId=... (HU-ERD-51)
// Admin-only, mismo criterio que relation-definitions (ERD-77): definir
// automatizaciones es configuracion de la plataforma. `entityId` opcional
// filtra al trigger de una sola entidad (pestaña de administracion de un
// modulo puntual); sin el, lista todo el tenant.
const querySchema = z.object({ entityId: z.string().uuid().optional() })

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  return listTriggers(auth.tenantId, query.entityId)
})
