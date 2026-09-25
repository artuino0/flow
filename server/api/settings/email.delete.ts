import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { deleteSesResources, readSesPlatformConfig } from '~/server/utils/sesTenants'

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const [current] = await withTenant(auth.tenantId, tx => tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId)).limit(1))
  // Quitar SES libera el dominio y el tenant de SES de la organización (mejor esfuerzo).
  if (current?.provider === 'ses' && readSesPlatformConfig()) await deleteSesResources(auth.tenantId, current.sendingDomain).catch(() => undefined)
  await withTenant(auth.tenantId, async (tx) => {
    await tx.delete(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId))
  })
  return { ok: true, source: 'environment' }
})
