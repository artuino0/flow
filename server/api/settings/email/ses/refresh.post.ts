import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { buildDnsRecords, fetchSesStatus, readSesPlatformConfig } from '~/server/utils/sesTenants'

// POST /api/settings/email/ses/refresh - vuelve a consultar a SES si el dominio
// ya está verificado y si el tenant sigue habilitado (SES lo pausa por reputación).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  if (!readSesPlatformConfig()) throw createError({ statusCode: 503, statusMessage: 'El envío con Amazon SES no está habilitado en este servidor' })
  const row = await withTenant(auth.tenantId, async (tx) => {
    const [value] = await tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId)).limit(1)
    return value ?? null
  })
  if (!row || row.provider !== 'ses' || !row.sendingDomain) throw createError({ statusCode: 404, statusMessage: 'Esta organización no usa Amazon SES' })

  let status
  try {
    status = await fetchSesStatus(auth.tenantId, row.sendingDomain)
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: `No se pudo consultar Amazon SES: ${(error as Error).message}` })
  }
  const sendingStatus = status.domainStatus === 'verified' ? status.sendingStatus : null
  await withTenant(auth.tenantId, tx => tx.update(tenantEmailSettings).set({
    domainStatus: status.domainStatus,
    sendingStatus,
    dkimTokens: status.dkimTokens,
    statusCheckedAt: new Date(),
    updatedAt: new Date()
  }).where(eq(tenantEmailSettings.id, row.id)))
  return { ok: true, domain: row.sendingDomain, domainStatus: status.domainStatus, sendingStatus, dnsRecords: buildDnsRecords(row.sendingDomain, status.dkimTokens) }
})
