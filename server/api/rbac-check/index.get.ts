import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import type { PermissionAction } from '~/server/utils/rbac'

// Endpoint de ejemplo (HU-ERD-15) que demuestra el uso del guard RBAC
// reutilizable sobre una entidad generica: /api/rbac-check?entity=clientes&action=canRead
const querySchema = z.object({
  entity: z.string().min(1),
  action: z.enum(['canRead', 'canCreate', 'canUpdate', 'canDelete'])
})

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, querySchema.parse)
  const { auth, entity } = await requirePermission(event, query.entity, query.action as PermissionAction)
  return { allowed: true, entity, action: query.action, auth }
})
