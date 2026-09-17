import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  await withTenant(auth.tenantId, async (tx) => {
    await tx.delete(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId))
  })
  return { ok: true, source: 'environment' }
})
