import { requireAdminRole } from '~/server/utils/rbac'
import { deleteTenantLogo } from '~/server/utils/tenantLogo'

// DELETE /api/tenant/logo (ERD-62) - admin-gated, igual que POST. Idempotente
// (200 con removed:false si el tenant no tenia logo).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const removed = await deleteTenantLogo(auth.tenantId)
  return { removed }
})
