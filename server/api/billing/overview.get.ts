import { requireAdminRole } from '~/server/utils/rbac'
import { captureTenantUsage, getBillingOverview } from '~/server/utils/billing'

// Resumen para la franja fija de plan/consumo y la pantalla de actualización.
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  await captureTenantUsage(auth.tenantId)
  return getBillingOverview(auth.tenantId)
})
