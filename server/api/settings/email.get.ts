import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { buildDnsRecords, readSesPlatformConfig } from '~/server/utils/sesTenants'

function envSummary() {
  const host = process.env.SMTP_HOST || ''
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER || ''
  const from = process.env.SMTP_FROM || ''
  const configured = Boolean(host && port && user && process.env.SMTP_PASSWORD && from)
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return { configured, provider: 'smtp', host, port, security: port === 465 ? 'ssl' : 'tls', username: user, fromEmail: match?.[2] || from, fromName: match?.[1] || 'Flow', replyTo: '', passwordConfigured: Boolean(process.env.SMTP_PASSWORD), apiKeyConfigured: false }
}

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const row = await withTenant(auth.tenantId, async (tx) => {
    const [value] = await tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId)).limit(1)
    return value ?? null
  })
  // sesAvailable: la plataforma tiene Amazon SES habilitado (las organizaciones pueden registrar su dominio).
  const sesAvailable = Boolean(readSesPlatformConfig())
  if (!row) return { source: 'environment', ...envSummary(), customConfigured: false, sesAvailable }
  const ses = row.provider === 'ses' && row.sendingDomain
    ? {
        sendingDomain: row.sendingDomain,
        domainStatus: row.domainStatus ?? 'pending',
        sendingStatus: row.sendingStatus,
        statusCheckedAt: row.statusCheckedAt,
        dnsRecords: buildDnsRecords(row.sendingDomain, Array.isArray(row.dkimTokens) ? row.dkimTokens as string[] : [])
      }
    : null
  return {
    sesAvailable,
    ses,
    source: 'database',
    customConfigured: true,
    configured: row.provider === 'ses' ? row.domainStatus === 'verified' && row.sendingStatus !== 'paused' : Boolean(row.host && row.port && row.username && row.passwordEncrypted && row.fromEmail),
    provider: row.provider,
    host: row.host || '',
    port: row.port || 587,
    security: row.security,
    username: row.username || '',
    fromEmail: row.fromEmail,
    fromName: row.fromName || '',
    replyTo: row.replyTo || '',
    passwordConfigured: Boolean(row.passwordEncrypted),
    apiKeyConfigured: Boolean(row.apiKeyEncrypted)
  }
})
