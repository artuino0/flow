import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('stripe', () => ({ default: class {
  customers = { create: async () => ({ id: 'cus_intent186' }) }
  checkout = { sessions: { create: async (input: Record<string, unknown>) => { calls.push(input); return { url: 'https://checkout.stripe.test/186' } } } }
} }))
let fixture: TestDb, admin: postgres.Sql
let intents: typeof import('../../server/utils/registrationIntent')
let registration: typeof import('../../server/utils/registration')
let billing: typeof import('../../server/utils/billing')
let verification: typeof import('../../server/utils/emailVerification')
let index = 0
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('defineCachedEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRequestURL', (event: { path: string }) => new URL(`http://localhost${event.path}`))
  fixture = await createTestDb()
  admin = postgres(fixture.adminUrl)
  process.env.APP_DATABASE_URL = fixture.appUrl
  process.env.PLAN_CACHE_TTL_MS = '0'
  process.env.STRIPE_SECRET_KEY = 'sk_test_simulated186'
  intents = await import('../../server/utils/registrationIntent')
  registration = await import('../../server/utils/registration')
  billing = await import('../../server/utils/billing')
  verification = await import('../../server/utils/emailVerification')
  await admin`update plans set stripe_monthly_price_id = 'price186_' || key, stripe_annual_price_id = 'price186_year_' || key`
}, 120_000)
afterAll(async () => {
  if (admin) await admin.end()
  if (fixture) await fixture.stop()
  for (const key of ['APP_DATABASE_URL', 'PLAN_CACHE_TTL_MS', 'STRIPE_SECRET_KEY']) delete process.env[key]
  vi.unstubAllGlobals()
})
async function account(choice: unknown = { plan: 'starter', interval: 'year', utm_source: 'landing' }) {
  index++
  return registration.registerTenant({ fullName: 'Prueba', email: `intent186-${index}@local.test`, password: 'Passw0rd!186', organizationName: 'Intención', slug: `intent186-${index}`, registrationChoice: choice })
}
it('el catálogo público tiene exclusivamente campos permitidos y solo planes públicos activos', async () => {
  const endpoint = (await import('../../server/api/public/plans.get')).default
  const auth = (await import('../../server/middleware/auth')).default
  await expect(auth({ path: '/api/public/plans' } as unknown as Parameters<typeof auth>[0])).resolves.toBeUndefined()
  expect(await endpoint({} as Parameters<typeof endpoint>[0])).toEqual({ plans: await intents.publicRegistrationPlans() })
  const catalog = await intents.publicRegistrationPlans()
  expect(catalog.length).toBeGreaterThanOrEqual(4)
  for (const plan of catalog) expect(Object.keys(plan).sort()).toEqual(['key', 'name', 'description', 'monthlyPriceCents', 'annualPriceCents', 'currency'].sort())
  expect(catalog.some(plan => plan.key === 'empresarial')).toBe(false)
  await admin`update plans set is_public = false where key = 'escala'`
  expect(await intents.validateRegistrationChoice({ plan: 'escala' })).toBeNull()
  expect((await intents.publicRegistrationPlans()).some(plan => plan.key === 'escala')).toBe(false)
  await admin`update plans set is_public = true, active = false where key = 'escala'`
  expect(await intents.validateRegistrationChoice({ plan: 'escala' })).toBeNull()
  await admin`update plans set active = true where key = 'escala'`
})
it('la cuenta existente distingue el Starter de respaldo de una suscripción activa', async () => {
  const a = await account(null)
  await admin`update tenants set onboarding_status = 'complete' where id = ${a.tenantId}`
  await billing.getTenantSubscription(a.tenantId)
  expect(await intents.saveRegistrationChoice(a.tenantId, { plan: 'starter' })).toMatchObject({ plan: 'starter', interval: 'month' })
  await admin`update tenant_subscriptions set trial_ends_at = now() + interval '10 days' where tenant_id = ${a.tenantId}`
  expect(await intents.saveRegistrationChoice(a.tenantId, { plan: 'agenda' })).toBeNull()
  expect((await intents.getRegistrationChoice(a.tenantId)).intent).toBeNull()
  await admin`update tenant_subscriptions set status = 'active' where tenant_id = ${a.tenantId}`
  expect(await intents.saveRegistrationChoice(a.tenantId, { plan: 'agenda' })).toBeNull()
  expect((await intents.getRegistrationChoice(a.tenantId)).intent).toBeNull()
})
it('persiste registro, verificación en otro dispositivo y lectura tras login; Checkout no concede plan', async () => {
  const a = await account()
  const expected = { intent: { plan: 'starter', interval: 'year' }, unavailable: false }
  expect(await intents.getRegistrationChoice(a.tenantId)).toEqual(expected)
  // Token entregado al otro dispositivo: se ejecuta la confirmación real sin SMTP.
  const token = 'token-intent186-other-device'
  const { createHash } = await import('node:crypto')
  await admin`insert into email_verification_tokens (person_id, tenant_id, token_hash, expires_at) values (${a.personId}, ${a.tenantId}, ${createHash('sha256').update(token).digest('hex')}, now() + interval '1 hour')`
  expect(await verification.confirmEmailVerification(token)).toBe(true)
  expect(await intents.getRegistrationChoice(a.tenantId)).toEqual(expected)
  await billing.createStripeCheckout(a.tenantId, 'starter', 'year')
  expect(calls.at(-1)).toMatchObject({ line_items: [{ price: 'price186_year_starter', quantity: 1 }], payment_method_collection: 'always', subscription_data: { trial_period_days: 30 } })
  expect(await intents.getRegistrationChoice(a.tenantId)).toEqual(expected)
  const [row] = await admin`select onboarding_status from tenants where id = ${a.tenantId}`
  expect(row!.onboarding_status).toBe('checkout_pending')
  await billing.syncStripeSubscription({ id: 'sub_intent186', status: 'trialing', metadata: { tenantId: a.tenantId }, customer: 'cus_intent186', trial_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false, items: { data: [{ price: { id: 'price186_year_starter', recurring: { interval: 'year' } } }] } } as Parameters<typeof billing.syncStripeSubscription>[0])
  expect(await intents.getRegistrationChoice(a.tenantId)).toEqual({ intent: null, unavailable: false })
  expect(await intents.saveRegistrationChoice(a.tenantId, { plan: 'agenda' })).toBeNull()
})
it('expira, limpia al cambiar y avisa si el plan deja de estar disponible', async () => {
  const a = await account()
  await admin`update tenants set registration_intent = jsonb_set(registration_intent, '{expiresAt}', '"2000-01-01T00:00:00Z"') where id = ${a.tenantId}`
  expect((await intents.getRegistrationChoice(a.tenantId)).intent).toBeNull()
  await intents.saveRegistrationChoice(a.tenantId, { plan: 'escala' })
  await admin`update plans set active = false where key = 'escala'`
  expect(await intents.getRegistrationChoice(a.tenantId)).toEqual({ intent: null, unavailable: true })
  await admin`update plans set active = true where key = 'escala'`
  await intents.saveRegistrationChoice(a.tenantId, { plan: 'agenda' })
  await intents.clearRegistrationChoice(a.tenantId)
  expect((await intents.getRegistrationChoice(a.tenantId)).intent).toBeNull()
})
it('cuenta existente sin contratación acepta Agenda y conserva el Checkout existente', async () => {
  const a = await account(null)
  await admin`update people set email_verified_at = now() where id = ${a.personId}`
  await admin`update tenants set onboarding_status = 'plan_pending' where id = ${a.tenantId}`
  await intents.saveRegistrationChoice(a.tenantId, { plan: 'agenda' })
  await billing.createStripeCheckout(a.tenantId, 'agenda', 'month')
  expect(calls.at(-1)).toMatchObject({ line_items: [{ price: 'price186_agenda', quantity: 1 }] })
  await billing.syncStripeSubscription({ id: 'sub_agenda186', status: 'active', metadata: { tenantId: a.tenantId }, customer: 'cus_intent186', trial_end: null, cancel_at_period_end: false, items: { data: [{ price: { id: 'price186_agenda', recurring: { interval: 'month' } } }] } } as Parameters<typeof billing.syncStripeSubscription>[0])
  const entities = await admin`select slug from entities where tenant_id = ${a.tenantId} and template_key = 'agenda'`
  expect(entities).toHaveLength(5)
  const schedules = await admin`select id from agenda_schedules where tenant_id = ${a.tenantId}`
  expect(schedules.length).toBeGreaterThan(0)
  expect((await intents.getRegistrationChoice(a.tenantId)).intent).toBeNull()
})
