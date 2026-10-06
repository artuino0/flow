import {
  CreateConfigurationSetCommand,
  CreateEmailIdentityCommand,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  DeleteConfigurationSetCommand,
  DeleteEmailIdentityCommand,
  DeleteTenantCommand,
  DeleteTenantResourceAssociationCommand,
  GetEmailIdentityCommand,
  GetTenantCommand,
  SESv2Client
} from '@aws-sdk/client-sesv2'

// Amazon SES Tenant Management: cada organización de Flow es un "tenant" de SES
// con su propio dominio verificado y configuration set. SES mide la reputación
// por tenant y, si una organización se pasa (rebotes, quejas), pausa solo a esa
// sin afectar a las demás. Ver docs.aws.amazon.com/ses/latest/dg/tenants.html
//
// Variables de entorno de la plataforma (una sola cuenta de AWS):
//   SES_REGION                       región de SES (los tenants son por región)
//   SES_SMTP_USER / SES_SMTP_PASSWORD  credenciales SMTP de SES (no las de la consola)
//   SES_SMTP_HOST / SES_SMTP_PORT      opcionales (por defecto email-smtp.<región>.amazonaws.com:587)
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  credenciales IAM para la API de SES
//                                    (o el rol del entorno) con permisos sobre tenants,
//                                    identidades y configuration sets.

export class SesNotConfiguredError extends Error {}
export class SesProvisioningError extends Error {}

export interface SesPlatformConfig {
  region: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
}

/** Configuración de la plataforma, o null si SES no está habilitado en este servidor. */
export function readSesPlatformConfig(env: NodeJS.ProcessEnv = process.env): SesPlatformConfig | null {
  const region = env.SES_REGION?.trim()
  const smtpUser = env.SES_SMTP_USER?.trim()
  const smtpPassword = env.SES_SMTP_PASSWORD
  if (!region || ((!smtpUser || !smtpPassword) && !(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) && !env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI && !env.AWS_CONTAINER_CREDENTIALS_FULL_URI && !env.AWS_WEB_IDENTITY_TOKEN_FILE)) return null
  const port = Number(env.SES_SMTP_PORT || 587)
  return {
    region,
    smtpHost: env.SES_SMTP_HOST?.trim() || `email-smtp.${region}.amazonaws.com`,
    smtpPort: Number.isInteger(port) && port > 0 ? port : 587,
    smtpUser: smtpUser ?? '',
    smtpPassword: smtpPassword ?? ''
  }
}

const DOMAIN_PATTERN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain)
}

/** El remitente debe estar en el dominio verificado (o en un subdominio suyo). */
export function emailBelongsToDomain(email: string, domain: string): boolean {
  const host = email.trim().toLowerCase().split('@')[1] ?? ''
  return host === domain || host.endsWith(`.${domain}`)
}

export function sesResourceNames(tenantId: string) {
  return { tenantName: `flow-${tenantId}`, configurationSet: `flow-${tenantId}` }
}

export interface DnsRecord { type: 'CNAME' | 'TXT'; name: string; value: string; purpose: string }

/** Registros DNS que el cliente debe publicar para verificar su dominio (DKIM) y proteger su reputación. */
export function buildDnsRecords(domain: string, dkimTokens: string[]): DnsRecord[] {
  return [
    ...dkimTokens.map(token => ({ type: 'CNAME' as const, name: `${token}._domainkey.${domain}`, value: `${token}.dkim.amazonses.com`, purpose: 'DKIM' })),
    { type: 'TXT', name: `_dmarc.${domain}`, value: 'v=DMARC1; p=none;', purpose: 'DMARC (recomendado)' }
  ]
}

export type SesDomainStatus = 'pending' | 'verified' | 'failed'
export type SesSendingStatus = 'enabled' | 'paused'

let cachedClient: { region: string; client: SESv2Client } | null = null
export function getSesClient(config = readSesPlatformConfig()): SESv2Client {
  if (!config) throw new SesNotConfiguredError('Amazon SES no está configurado. Completa SES_REGION y configura credenciales IAM o un rol AWS.')
  if (!cachedClient || cachedClient.region !== config.region) cachedClient = { region: config.region, client: new SESv2Client({ region: config.region, requestHandler: { connectionTimeout: 10000, requestTimeout: 10000 }, maxAttempts: 1 }) }
  return cachedClient.client
}

function errorName(error: unknown): string {
  return (error as { name?: string })?.name ?? ''
}
const ALREADY_EXISTS = new Set(['AlreadyExistsException', 'ConflictException'])

async function ignoreExisting<T>(action: Promise<T>): Promise<T | null> {
  try { return await action } catch (error) {
    if (ALREADY_EXISTS.has(errorName(error))) return null
    throw error
  }
}

function accountFromArn(arn: string | undefined): string {
  const account = arn?.split(':')[4]
  if (!account) throw new SesProvisioningError('No se pudo determinar la cuenta de AWS a partir del tenant de SES')
  return account
}

export interface ProvisionedDomain {
  tenantName: string
  configurationSet: string
  domain: string
  dkimTokens: string[]
  domainStatus: SesDomainStatus
}

/**
 * Crea (o reutiliza) el tenant de SES de la organización, su configuration set y la
 * identidad del dominio con DKIM, y los asocia. Idempotente: se puede repetir.
 */
export async function provisionSesDomain(tenantId: string, rawDomain: string, client = getSesClient(), config = readSesPlatformConfig()): Promise<ProvisionedDomain> {
  if (!config) throw new SesNotConfiguredError('Amazon SES no está configurado en este servidor.')
  const domain = normalizeDomain(rawDomain)
  if (!isValidDomain(domain)) throw new SesProvisioningError('El dominio no es válido')
  const { tenantName, configurationSet } = sesResourceNames(tenantId)

  await ignoreExisting(client.send(new CreateTenantCommand({ TenantName: tenantName, Tags: [{ Key: 'app', Value: 'flow' }, { Key: 'flowTenantId', Value: tenantId }] })))
  const tenant = await client.send(new GetTenantCommand({ TenantName: tenantName }))
  const account = accountFromArn(tenant.Tenant?.TenantArn)

  await ignoreExisting(client.send(new CreateConfigurationSetCommand({ ConfigurationSetName: configurationSet })))

  let dkimTokens: string[] = []
  let verified = false
  let dkimStatus: string | undefined
  const created = await ignoreExisting(client.send(new CreateEmailIdentityCommand({
    EmailIdentity: domain,
    ConfigurationSetName: configurationSet,
    DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
    Tags: [{ Key: 'flowTenantId', Value: tenantId }]
  })))
  if (created) {
    dkimTokens = created.DkimAttributes?.Tokens ?? []
    verified = Boolean(created.VerifiedForSendingStatus)
    dkimStatus = created.DkimAttributes?.Status
  } else {
    const existing = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
    // Si la identidad ya existe pero pertenece a OTRA organización no debe adoptarse.
    const owner = existing.Tags?.find(tag => tag.Key === 'flowTenantId')?.Value
    if (owner !== tenantId) throw new SesProvisioningError('Este dominio ya está registrado en la cuenta de correo de la plataforma')
    dkimTokens = existing.DkimAttributes?.Tokens ?? []
    verified = Boolean(existing.VerifiedForSendingStatus)
    dkimStatus = existing.DkimAttributes?.Status
  }

  const region = config.region
  await ignoreExisting(client.send(new CreateTenantResourceAssociationCommand({ TenantName: tenantName, ResourceArn: `arn:aws:ses:${region}:${account}:identity/${domain}` })))
  await ignoreExisting(client.send(new CreateTenantResourceAssociationCommand({ TenantName: tenantName, ResourceArn: `arn:aws:ses:${region}:${account}:configuration-set/${configurationSet}` })))

  return { tenantName, configurationSet, domain, dkimTokens, domainStatus: verified ? 'verified' : dkimStatus === 'FAILED' ? 'failed' : 'pending' }
}

export interface SesStatus {
  domainStatus: SesDomainStatus
  sendingStatus: SesSendingStatus
  dkimTokens: string[]
}

/** Consulta a SES si el dominio ya está verificado y si el tenant sigue habilitado para enviar. */
export async function fetchSesStatus(tenantId: string, rawDomain: string, client = getSesClient()): Promise<SesStatus> {
  const domain = normalizeDomain(rawDomain)
  const { tenantName } = sesResourceNames(tenantId)
  const identity = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
  const tenant = await client.send(new GetTenantCommand({ TenantName: tenantName }))
  const verified = Boolean(identity.VerifiedForSendingStatus)
  return {
    domainStatus: verified ? 'verified' : identity.DkimAttributes?.Status === 'FAILED' ? 'failed' : 'pending',
    sendingStatus: tenant.Tenant?.SendingStatus === 'DISABLED' ? 'paused' : 'enabled',
    dkimTokens: identity.DkimAttributes?.Tokens ?? []
  }
}

/** Limpieza al quitar SES de una organización. Nunca lanza: lo que ya no exista se ignora. */
export async function deleteSesResources(tenantId: string, rawDomain: string | null | undefined, client = getSesClient()): Promise<void> {
  const { tenantName, configurationSet } = sesResourceNames(tenantId)
  const domain = rawDomain ? normalizeDomain(rawDomain) : null
  const config = readSesPlatformConfig()
  const attempt = async (action: Promise<unknown>) => { try { await action } catch { /* ya no existe o sin permiso: no bloquea */ } }
  try {
    const tenant = await client.send(new GetTenantCommand({ TenantName: tenantName }))
    const account = accountFromArn(tenant.Tenant?.TenantArn)
    if (config && domain) await attempt(client.send(new DeleteTenantResourceAssociationCommand({ TenantName: tenantName, ResourceArn: `arn:aws:ses:${config.region}:${account}:identity/${domain}` })))
    if (config) await attempt(client.send(new DeleteTenantResourceAssociationCommand({ TenantName: tenantName, ResourceArn: `arn:aws:ses:${config.region}:${account}:configuration-set/${configurationSet}` })))
  } catch { /* el tenant no existe */ }
  if (domain) await attempt(client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain })))
  await attempt(client.send(new DeleteConfigurationSetCommand({ ConfigurationSetName: configurationSet })))
  await attempt(client.send(new DeleteTenantCommand({ TenantName: tenantName })))
}
