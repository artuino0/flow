import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { buildDnsRecords, deleteSesResources, emailBelongsToDomain, isValidDomain, normalizeDomain, provisionSesDomain, readSesPlatformConfig, SesNotConfiguredError, SesProvisioningError } from '~/server/utils/sesTenants'

// POST /api/settings/email/ses { domain, fromEmail, fromName?, replyTo? }
// Registra el dominio de la organización en Amazon SES (tenant propio + DKIM) y
// devuelve los registros DNS que el cliente debe publicar. El envío por SES solo
// se habilita cuando el dominio queda verificado (POST /api/settings/email/ses/refresh).
const bodySchema = z.object({
  domain: z.string().trim().min(3).max(253),
  fromEmail: z.string().trim().email(),
  fromName: z.string().trim().max(120).optional().default(''),
  replyTo: z.string().trim().email().optional().or(z.literal('')).default('')
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  if (!readSesPlatformConfig()) throw createError({ statusCode: 503, statusMessage: 'El envío con Amazon SES no está habilitado en este servidor' })

  const domain = normalizeDomain(body.domain)
  if (!isValidDomain(domain)) throw createError({ statusCode: 422, statusMessage: 'Escribe un dominio válido, por ejemplo empresa.com' })
  if (!emailBelongsToDomain(body.fromEmail, domain)) throw createError({ statusCode: 422, statusMessage: `El correo remitente debe pertenecer a ${domain}` })

  const previous = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId)).limit(1)
    return row ?? null
  })

  // Si cambió de dominio, la identidad anterior ya no se usa: se libera antes de registrar la nueva.
  if (previous?.provider === 'ses' && previous.sendingDomain && previous.sendingDomain.toLowerCase() !== domain) {
    await deleteSesResources(auth.tenantId, previous.sendingDomain).catch(() => undefined)
  }

  let provisioned
  try {
    provisioned = await provisionSesDomain(auth.tenantId, domain)
  } catch (error) {
    if (error instanceof SesProvisioningError) throw createError({ statusCode: 409, statusMessage: error.message })
    if (error instanceof SesNotConfiguredError) throw createError({ statusCode: 503, statusMessage: error.message })
    throw createError({ statusCode: 502, statusMessage: `Amazon SES rechazó la solicitud: ${(error as Error).message}` })
  }

  const values = {
    tenantId: auth.tenantId,
    provider: 'ses',
    host: null,
    port: null,
    security: 'tls',
    username: null,
    passwordEncrypted: null,
    apiKeyEncrypted: null,
    fromEmail: body.fromEmail,
    fromName: body.fromName || null,
    replyTo: body.replyTo || null,
    sesTenantName: provisioned.tenantName,
    sesConfigSet: provisioned.configurationSet,
    sendingDomain: provisioned.domain,
    domainStatus: provisioned.domainStatus,
    dkimTokens: provisioned.dkimTokens,
    sendingStatus: provisioned.domainStatus === 'verified' ? 'enabled' : null,
    statusCheckedAt: new Date(),
    createdBy: previous?.createdBy ?? auth.sub,
    updatedAt: new Date()
  }
  try {
    await withTenant(auth.tenantId, async (tx) => {
      if (previous) await tx.update(tenantEmailSettings).set(values).where(eq(tenantEmailSettings.id, previous.id))
      else await tx.insert(tenantEmailSettings).values(values)
    })
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code
    if (code === '23505') throw createError({ statusCode: 409, statusMessage: 'Este dominio ya está registrado por otra organización' })
    throw error
  }
  return { ok: true, domain: provisioned.domain, domainStatus: provisioned.domainStatus, dnsRecords: buildDnsRecords(provisioned.domain, provisioned.dkimTokens) }
})
