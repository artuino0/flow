import { requireAdminRole } from '~/server/utils/rbac'
import { getStorageUsage } from '~/server/utils/storageUsage'

// Solo administradores ven el consumo y los límites del plan.
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return getStorageUsage(auth.tenantId)
})
