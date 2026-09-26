import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { tenantLimitOverrides } from '~/server/db/schema'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { invalidatePlanCache, PLAN_CONCEPTS, syncTenantStorageLimit } from '~/server/utils/plans'
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  const tenantId = z.string().uuid().parse(getRouterParam(event, 'tenantId'))
  const concept = z.enum(PLAN_CONCEPTS).parse(getRouterParam(event, 'concept'))
  await withTenant(tenantId, tx => tx.delete(tenantLimitOverrides).where(and(eq(tenantLimitOverrides.tenantId, tenantId), eq(tenantLimitOverrides.concept, concept))))
  invalidatePlanCache(tenantId)
  await syncTenantStorageLimit(tenantId)
  return { ok: true }
})
