import { getQuery } from 'h3'
import { requireAdminRole } from '~/server/utils/rbac'
import { captureTenantUsage, getTenantUsage, getUsageHistory } from '~/server/utils/billing'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const requestedDays = Number(getQuery(event).days ?? 90)
  const days = Number.isFinite(requestedDays) ? Math.max(7, Math.min(365, Math.floor(requestedDays))) : 90
  await captureTenantUsage(auth.tenantId)
  const [current, history] = await Promise.all([getTenantUsage(auth.tenantId), getUsageHistory(auth.tenantId, days)])
  return { current, history }
})
