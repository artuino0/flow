import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

const checkoutCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('stripe', () => ({
  default: class {
    customers = { create: async () => ({ id: 'cus_registration_test' }) }
    checkout = { sessions: { create: async (input: Record<string, unknown>) => {
      checkoutCalls.push(input)
      return { url: 'https://checkout.stripe.test/simulado' }
    } } }
  }
}))

let testDb: TestDb
let admin: postgres.Sql
let registerTenant: typeof import('../../server/utils/registration').registerTenant
let verification: typeof import('../../server/utils/emailVerification')
let billing: typeof import('../../server/utils/billing')
let installAgendaTemplate: typeof import('../../server/utils/agendaTemplate').installAgendaTemplate
let authMiddleware: (event: { path: string; context: Record<string, unknown> }) => Promise<void>
let signAuthToken: typeof import('../../server/utils/auth').signAuthToken

beforeAll(async () => {
  vi.stubGlobal('createError', (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'Error')), options))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRequestURL', (event: { path: string }) => new URL(`http://localhost${event.path}`))
  vi.stubGlobal('getHeader', (_event: unknown, name: string) => name === 'authorization' ? `Bearer ${currentToken}` : null)
  vi.stubGlobal('getCookie', () => null)
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: 'secret-registration-115' }))
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  Object.assign(process.env, {
    APP_DATABASE_URL: testDb.appUrl, PLAN_CACHE_TTL_MS: '0', STRIPE_SECRET_KEY: 'sk_test_registration_115',
    SMTP_HOST: 'localhost', SMTP_PORT: '2525', SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_FROM: 'Flow <test@local.test>'
  })
  await admin`update plans set stripe_monthly_price_id = 'price_' || key where key in ('starter', 'crecimiento', 'agenda')`
  ;({ registerTenant } = await import('../../server/utils/registration'))
  verification = await import('../../server/utils/emailVerification')
  billing = await import('../../server/utils/billing')
  ;({ installAgendaTemplate } = await import('../../server/utils/agendaTemplate'))
  ;({ signAuthToken } = await import('../../server/utils/auth'))
  authMiddleware = (await import('../../server/middleware/auth')).default as typeof authMiddleware
}, 120_000)

afterAll(async () => {
  if (admin) await admin.end()
  if (testDb) await testDb.stop()
  for (const key of ['APP_DATABASE_URL', 'PLAN_CACHE_TTL_MS', 'STRIPE_SECRET_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) delete process.env[key]
  vi.unstubAllGlobals()
})

let currentToken = ''
const request = (path: string) => authMiddleware({ path, context: {} })

describe('registro, prueba y plantilla Agenda', () => {
  it('cambiar correo invalida el enlace anterior y respeta el límite sin modificarlo al rechazar', async () => {
    const account = await registerTenant({
      fullName: 'Otra Persona', email: 'anterior115@local.test', password: 'Passw0rd!115',
      organizationName: 'Cambio Correo 115', slug: 'cambio-correo-115'
    })
    await verification.issueEmailVerification(account.personId, account.tenantId)
    const [oldMail] = await admin`select payload from job_queue where tenant_id = ${account.tenantId} and kind = 'email' order by created_at desc limit 1`
    const oldLink = String(oldMail!.payload.html).match(/https?:\/\/[^"<> ]+/)?.[0]
    const oldToken = new URL(oldLink!).searchParams.get('token')!
    await verification.issueEmailVerification(account.personId, account.tenantId, true, 'nuevo115@local.test')
    expect(await verification.confirmEmailVerification(oldToken)).toBe(false)
    const [changed] = await admin`select email from people where id = ${account.personId}`
    expect(changed!.email).toBe('nuevo115@local.test')
    for (let index = 0; index < 3; index++) await verification.issueEmailVerification(account.personId, account.tenantId, true)
    await expect(verification.issueEmailVerification(account.personId, account.tenantId, true, 'tercero115@local.test'))
      .rejects.toBeInstanceOf(verification.VerificationRateLimitError)
    const [unchanged] = await admin`select email from people where id = ${account.personId}`
    expect(unchanged!.email).toBe('nuevo115@local.test')
  }, 120_000)

  it('verifica correo de un solo uso, exige tarjeta y prueba, instala Agenda una vez y cuenta solo módulos propios', async () => {
    const account = await registerTenant({
      fullName: 'Usuario Prueba', email: 'registro115@local.test', password: 'Passw0rd!115',
      organizationName: 'Agenda 115', slug: 'agenda-115'
    })
    const [unverified] = await admin`select email_verified_at from people where id = ${account.personId}`
    const [pending] = await admin`select onboarding_status from tenants where id = ${account.tenantId}`
    expect(unverified!.email_verified_at).toBeNull()
    expect(pending!.onboarding_status).toBe('email_pending')
    currentToken = signAuthToken({ sub: account.userId, tenantId: account.tenantId, roleId: account.adminRoleId }, 'secret-registration-115')
    await expect(request('/api/entities')).rejects.toMatchObject({ statusCode: 403 })
    await expect(request('/api/auth/me')).resolves.toBeUndefined()
    await expect(billing.createStripeCheckout(account.tenantId, 'agenda', 'month')).rejects.toThrow(/Confirma tu correo/)

    await verification.issueEmailVerification(account.personId, account.tenantId)
    const [mail] = await admin`select payload from job_queue where tenant_id = ${account.tenantId} and kind = 'email' order by created_at desc limit 1`
    const link = String(mail!.payload.html).match(/https?:\/\/[^"<> ]+/)?.[0]
    expect(link).toBeTruthy()
    const token = new URL(link!).searchParams.get('token')!
    expect(await verification.confirmEmailVerification(token)).toBe(true)
    expect(await verification.confirmEmailVerification(token)).toBe(false)
    const [verified] = await admin`select email_verified_at from people where id = ${account.personId}`
    expect(verified!.email_verified_at).not.toBeNull()
    const [waitingForPlan] = await admin`select onboarding_status from tenants where id = ${account.tenantId}`
    expect(waitingForPlan!.onboarding_status).toBe('plan_pending')
    await expect(request('/api/entities')).rejects.toMatchObject({ statusCode: 403 })
    await expect(request('/api/billing/checkout')).resolves.toBeUndefined()

    await expect(billing.createStripeCheckout(account.tenantId, 'agenda', 'month')).resolves.toEqual({ url: 'https://checkout.stripe.test/simulado' })
    expect(checkoutCalls.at(-1)).toMatchObject({ payment_method_collection: 'always', subscription_data: { trial_period_days: 30 } })
    const trialEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    const subscription = {
      id: 'sub_agenda_115', status: 'trialing', metadata: { tenantId: account.tenantId }, customer: 'cus_registration_test',
      trial_end: trialEnd, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_agenda', recurring: { interval: 'month' } } }] }
    } as Parameters<typeof billing.syncStripeSubscription>[0]
    await billing.syncStripeSubscription(subscription)
    await billing.syncStripeSubscription(subscription)
    await installAgendaTemplate(account.tenantId)
    const [active] = await admin`select onboarding_status, trial_consumed_at from tenants where id = ${account.tenantId}`
    const [subscriptionRow] = await admin`select status, trial_ends_at from tenant_subscriptions where tenant_id = ${account.tenantId}`
    expect(active!.onboarding_status).toBe('complete')
    expect(active!.trial_consumed_at).not.toBeNull()
    expect(subscriptionRow!.status).toBe('trialing')
    expect(subscriptionRow!.trial_ends_at).not.toBeNull()
    await expect(request('/api/entities')).resolves.toBeUndefined()

    const template = await admin`select slug, template_key from entities where tenant_id = ${account.tenantId} and template_key = 'agenda'`
    expect(template).toHaveLength(5)
    expect(template.map(row => row.slug).sort()).toEqual(['agenda-citas', 'agenda-clientes', 'agenda-recursos', 'agenda-servicios', 'agenda-servicios-cita'])
    const [limits] = await admin`select
      (select value from plan_limits where plan_id = (select id from plans where key = 'agenda') and concept = 'modules') as modules,
      (select value from plan_limits where plan_id = (select id from plans where key = 'agenda') and concept = 'aiCredits') as ai_credits`
    expect(Number(limits!.modules)).toBe(2)
    expect(Number(limits!.ai_credits)).toBe(5)
    const [board] = await admin`select board_config from entities where tenant_id = ${account.tenantId} and slug = 'agenda-citas'`
    expect(board!.board_config).toMatchObject({ enabled: true, statusField: 'estado' })
    const [owner] = await admin`select data_type, is_owner_field from entity_fields where entity_id = (select id from entities where tenant_id = ${account.tenantId} and slug = 'agenda-citas') and name = 'personal'`
    expect(owner).toMatchObject({ data_type: 'user', is_owner_field: true })
    const [personal] = await admin`select visibility from role_entity_permissions where role_id = (select id from roles where tenant_id = ${account.tenantId} and name = 'Personal') and entity_id = (select id from entities where tenant_id = ${account.tenantId} and slug = 'agenda-citas')`
    expect(personal!.visibility).toBe('own')
    const [personalRole] = await admin`select id from roles where tenant_id = ${account.tenantId} and name = 'Personal'`
    const [secondPerson] = await admin`insert into people (email, password_hash, full_name) values ('personal115@local.test', 'hash-de-prueba', 'Personal') returning id`
    const [secondUser] = await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${account.tenantId}, ${secondPerson!.id}, ${personalRole!.id}, true) returning id`
    const [citas] = await admin`select id from entities where tenant_id = ${account.tenantId} and slug = 'agenda-citas'`
    const [partidas] = await admin`select id from entities where tenant_id = ${account.tenantId} and slug = 'agenda-servicios-cita'`
    const [servicios] = await admin`select id from entities where tenant_id = ${account.tenantId} and slug = 'agenda-servicios'`
    const [servicio] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${account.tenantId}, ${servicios!.id}, ${admin.json({ nombre: 'Corte' })}) returning id`
    const [ownCita] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${account.tenantId}, ${citas!.id}, ${admin.json({ asunto: 'Propia', personal: secondUser!.id })}) returning id`
    const [otherCita] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${account.tenantId}, ${citas!.id}, ${admin.json({ asunto: 'Ajena', personal: account.userId })}) returning id`
    const [ownLine] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${account.tenantId}, ${partidas!.id}, ${admin.json({ cita: ownCita!.id, servicio: servicio!.id })}) returning id`
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${account.tenantId}, ${partidas!.id}, ${admin.json({ cita: otherCita!.id, servicio: servicio!.id })})`
    const app = postgres(testDb.appUrl)
    try {
      await app.begin(async tx => {
        await tx`select set_config('app.tenant_id', ${account.tenantId}, true)`
        await tx`select set_config('app.user_id', ${secondUser!.id}, true)`
        await tx`select set_config('app.role_id', ${personalRole!.id}, true)`
        const visible = await tx`select id from records where tenant_id = ${account.tenantId} and entity_id = ${partidas!.id}`
        expect(visible.map(row => row.id)).toEqual([ownLine!.id])
      })
    } finally { await app.end() }
    expect((await billing.getPlanUsage(account.tenantId)).usage.find(item => item.concept === 'modules')?.used).toBe(0)
    for (let index = 1; index <= 2; index++) {
      await billing.assertPlanCapacity(account.tenantId, 'modules')
      await admin`insert into entities (tenant_id, name, slug, module_kind) values (${account.tenantId}, ${`Propio ${index}`}, ${`propio-${index}`}, 'hecho')`
    }
    await expect(billing.assertPlanCapacity(account.tenantId, 'modules')).rejects.toMatchObject({ statusCode: 402 })

    await billing.createStripeCheckout(account.tenantId, 'agenda', 'month')
    expect(checkoutCalls.at(-1)).toMatchObject({ payment_method_collection: 'always' })
    expect((checkoutCalls.at(-1)!.subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined()
  }, 120_000)
})
