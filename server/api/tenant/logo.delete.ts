import { requireAdminRole } from '~/server/utils/rbac'
import { deleteManagedTenantLogo } from '~/server/utils/managedStorage'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return { removed: await deleteManagedTenantLogo(auth.tenantId) }
})
