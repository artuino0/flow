import { requireAdminRole } from '~/server/utils/rbac'
import { deleteManagedTenantLogo } from '~/server/utils/managedStorage'
import { invalidateTenantAccess } from '~/server/utils/shortCache'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const removed = await deleteManagedTenantLogo(auth.tenantId)
  invalidateTenantAccess(auth.tenantId)
  return { removed }
})
