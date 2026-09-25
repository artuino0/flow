import { describe, it, expect, vi } from 'vitest'
import type { SESv2Client } from '@aws-sdk/client-sesv2'
import {
  buildDnsRecords, deleteSesResources, emailBelongsToDomain, fetchSesStatus, isValidDomain, normalizeDomain,
  provisionSesDomain, readSesPlatformConfig, sesResourceNames, SesProvisioningError
} from '../../server/utils/sesTenants'

const TENANT = '11111111-2222-3333-4444-555555555555'
const config = { region: 'us-east-1', smtpHost: 'email-smtp.us-east-1.amazonaws.com', smtpPort: 587, smtpUser: 'u', smtpPassword: 'p' }
const TENANT_ARN = `arn:aws:ses:us-east-1:123456789012:tenant/flow-${TENANT}/abc`

class AlreadyExists extends Error { override name = 'AlreadyExistsException' }

/** Cliente falso: responde por nombre de comando y registra todo lo que se envía. */
function fakeClient(handlers: Record<string, (input: any) => unknown>) {
  const sent: Array<{ name: string; input: any }> = []
  const client = {
    send: vi.fn(async (command: { constructor: { name: string }; input: any }) => {
      const name = command.constructor.name.replace(/Command$/, '')
      sent.push({ name, input: command.input })
      const handler = handlers[name]
      if (!handler) return {}
      const result = handler(command.input)
      if (result instanceof Error) throw result
      return result
    })
  }
  return { client: client as unknown as SESv2Client, sent }
}

describe('sesTenants', () => {
  it('lee la configuración de la plataforma solo si está completa', () => {
    expect(readSesPlatformConfig({} as NodeJS.ProcessEnv)).toBeNull()
    expect(readSesPlatformConfig({ SES_REGION: 'us-east-1', SES_SMTP_USER: 'u' } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(readSesPlatformConfig({ SES_REGION: 'us-east-2', SES_SMTP_USER: 'u', SES_SMTP_PASSWORD: 'p' } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      region: 'us-east-2', smtpHost: 'email-smtp.us-east-2.amazonaws.com', smtpPort: 587
    })
  })

  it('normaliza y valida dominios y remitentes', () => {
    expect(normalizeDomain(' @Empresa.COM. ')).toBe('empresa.com')
    expect(isValidDomain('empresa.com')).toBe(true)
    expect(isValidDomain('mail.empresa.com.mx')).toBe(true)
    for (const bad of ['empresa', 'a b.com', '-x.com', 'x..com', 'empresa.c', 'http://x.com']) expect(isValidDomain(bad), bad).toBe(false)
    expect(emailBelongsToDomain('rh@empresa.com', 'empresa.com')).toBe(true)
    expect(emailBelongsToDomain('rh@mail.empresa.com', 'empresa.com')).toBe(true)
    expect(emailBelongsToDomain('rh@otraempresa.com', 'empresa.com')).toBe(false)
    expect(emailBelongsToDomain('rh@evilempresa.com', 'empresa.com')).toBe(false)
  })

  it('arma los registros DNS: un CNAME por token DKIM y el DMARC recomendado', () => {
    const records = buildDnsRecords('empresa.com', ['aaa', 'bbb', 'ccc'])
    expect(records.filter(record => record.type === 'CNAME')).toEqual([
      { type: 'CNAME', name: 'aaa._domainkey.empresa.com', value: 'aaa.dkim.amazonses.com', purpose: 'DKIM' },
      { type: 'CNAME', name: 'bbb._domainkey.empresa.com', value: 'bbb.dkim.amazonses.com', purpose: 'DKIM' },
      { type: 'CNAME', name: 'ccc._domainkey.empresa.com', value: 'ccc.dkim.amazonses.com', purpose: 'DKIM' }
    ])
    expect(records.at(-1)).toMatchObject({ type: 'TXT', name: '_dmarc.empresa.com' })
  })

  it('provisiona tenant, configuration set e identidad y los asocia', async () => {
    const { client, sent } = fakeClient({
      GetTenant: () => ({ Tenant: { TenantArn: TENANT_ARN, SendingStatus: 'ENABLED' } }),
      CreateEmailIdentity: () => ({ DkimAttributes: { Tokens: ['t1', 't2', 't3'], Status: 'PENDING' }, VerifiedForSendingStatus: false })
    })
    const result = await provisionSesDomain(TENANT, 'Empresa.com', client, config)
    expect(result).toEqual({ tenantName: `flow-${TENANT}`, configurationSet: `flow-${TENANT}`, domain: 'empresa.com', dkimTokens: ['t1', 't2', 't3'], domainStatus: 'pending' })
    expect(sent.map(item => item.name)).toEqual(['CreateTenant', 'GetTenant', 'CreateConfigurationSet', 'CreateEmailIdentity', 'CreateTenantResourceAssociation', 'CreateTenantResourceAssociation'])
    const associations = sent.filter(item => item.name === 'CreateTenantResourceAssociation').map(item => item.input.ResourceArn)
    expect(associations).toEqual([
      'arn:aws:ses:us-east-1:123456789012:identity/empresa.com',
      `arn:aws:ses:us-east-1:123456789012:configuration-set/flow-${TENANT}`
    ])
    expect(sent.find(item => item.name === 'CreateEmailIdentity')!.input).toMatchObject({ EmailIdentity: 'empresa.com', ConfigurationSetName: `flow-${TENANT}` })
  })

  it('es idempotente: si los recursos ya existen los reutiliza', async () => {
    const { client } = fakeClient({
      CreateTenant: () => new AlreadyExists('exists'),
      GetTenant: () => ({ Tenant: { TenantArn: TENANT_ARN } }),
      CreateConfigurationSet: () => new AlreadyExists('exists'),
      CreateEmailIdentity: () => new AlreadyExists('exists'),
      GetEmailIdentity: () => ({ Tags: [{ Key: 'flowTenantId', Value: TENANT }], DkimAttributes: { Tokens: ['t1'], Status: 'SUCCESS' }, VerifiedForSendingStatus: true }),
      CreateTenantResourceAssociation: () => new AlreadyExists('exists')
    })
    const result = await provisionSesDomain(TENANT, 'empresa.com', client, config)
    expect(result).toMatchObject({ domainStatus: 'verified', dkimTokens: ['t1'] })
  })

  it('no adopta una identidad que pertenece a otra organización', async () => {
    const { client } = fakeClient({
      GetTenant: () => ({ Tenant: { TenantArn: TENANT_ARN } }),
      CreateEmailIdentity: () => new AlreadyExists('exists'),
      GetEmailIdentity: () => ({ Tags: [{ Key: 'flowTenantId', Value: 'otra-organizacion' }], VerifiedForSendingStatus: true })
    })
    await expect(provisionSesDomain(TENANT, 'ajeno.com', client, config)).rejects.toBeInstanceOf(SesProvisioningError)
  })

  it('rechaza dominios inválidos sin llamar a AWS', async () => {
    const { client, sent } = fakeClient({})
    await expect(provisionSesDomain(TENANT, 'no es un dominio', client, config)).rejects.toBeInstanceOf(SesProvisioningError)
    expect(sent).toHaveLength(0)
  })

  it('traduce el estado de SES: verificado, fallido y tenant pausado', async () => {
    const status = (verified: boolean, dkim: string, tenant: string) => fetchSesStatus(TENANT, 'empresa.com', fakeClient({
      GetEmailIdentity: () => ({ VerifiedForSendingStatus: verified, DkimAttributes: { Status: dkim, Tokens: ['x'] } }),
      GetTenant: () => ({ Tenant: { SendingStatus: tenant } })
    }).client)
    expect(await status(true, 'SUCCESS', 'ENABLED')).toMatchObject({ domainStatus: 'verified', sendingStatus: 'enabled' })
    expect(await status(false, 'PENDING', 'ENABLED')).toMatchObject({ domainStatus: 'pending' })
    expect(await status(false, 'FAILED', 'ENABLED')).toMatchObject({ domainStatus: 'failed' })
    expect(await status(true, 'SUCCESS', 'DISABLED')).toMatchObject({ domainStatus: 'verified', sendingStatus: 'paused' })
    expect(await status(true, 'SUCCESS', 'REINSTATED')).toMatchObject({ sendingStatus: 'enabled' })
  })

  it('la limpieza no lanza aunque SES falle y usa los nombres de la organización', async () => {
    const { client, sent } = fakeClient({ GetTenant: () => new Error('boom'), DeleteEmailIdentity: () => new Error('boom') })
    await expect(deleteSesResources(TENANT, 'empresa.com', client)).resolves.toBeUndefined()
    const names = sesResourceNames(TENANT)
    expect(sent.find(item => item.name === 'DeleteConfigurationSet')!.input.ConfigurationSetName).toBe(names.configurationSet)
    expect(sent.find(item => item.name === 'DeleteTenant')!.input.TenantName).toBe(names.tenantName)
  })
})
