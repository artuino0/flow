import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createError } from 'h3'
import { createTestDb, type TestDb } from '../setup/testDb'

const simulation = vi.hoisted(() => ({ event: {} as Record<string, unknown> }))
vi.mock('h3', async original => ({ ...await original<typeof import('h3')>(), getHeader: () => 'simulated-signature', readRawBody: async () => '{}' }))
vi.mock('stripe', () => ({ default: class {
  customers = { create: async () => ({ id: 'cus_simulated187' }) }
  checkout = { sessions: { create: async () => ({ url: 'https://stripe.test/simulated187' }) } }
  webhooks = { constructEvent: () => simulation.event }
} }))
let fixture: TestDb, admin: postgres.Sql, app: postgres.Sql
let crm: typeof import('../../server/utils/platformCrm')
let queue: typeof import('../../server/utils/platformCrmQueue')
let jobs: typeof import('../../server/utils/jobQueue')
let registration: typeof import('../../server/utils/registration')
let billing: typeof import('../../server/utils/billing')
let destination: string, moduleId: string, index = 0
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('createError', createError)
  fixture = await createTestDb()
  admin = postgres(fixture.adminUrl)
  app = postgres(fixture.appUrl)
  process.env.APP_DATABASE_URL = fixture.appUrl
  process.env.DB_POOL_MAX = '3'
  process.env.PLAN_CACHE_TTL_MS = '0'
  process.env.STRIPE_SECRET_KEY = 'sk_test_simulated187'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_simulated187'
  crm = await import('../../server/utils/platformCrm')
  queue = await import('../../server/utils/platformCrmQueue')
  jobs = await import('../../server/utils/jobQueue')
  registration = await import('../../server/utils/registration')
  billing = await import('../../server/utils/billing')
  destination = (await account()).tenantId
  await admin`update tenants set slug = 'platform187' where id = ${destination}`
  await admin`insert into tenant_subscriptions (tenant_id, plan_id, provider, status) select ${destination}, id, 'manual', 'active' from plans where key = 'empresarial'`
  process.env.PLATFORM_CRM_TENANT_SLUG = 'platform187'
  await admin`update plans set stripe_monthly_price_id = 'price187_' || key, stripe_annual_price_id = 'price187_year_' || key`
}, 120_000)
afterAll(async () => {
  if (admin) await admin.end()
  if (app) await app.end()
  if (crm) await (await import('../../server/db')).client.end()
  if (fixture) await fixture.stop()
  for (const key of ['APP_DATABASE_URL', 'DB_POOL_MAX', 'PLAN_CACHE_TTL_MS', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PLATFORM_CRM_TENANT_SLUG']) delete process.env[key]
  vi.unstubAllGlobals()
})
async function account(choice: unknown = null) {
  index++
  return registration.registerTenant({ fullName: 'Prueba CRM', email: `crm187-${index}@local.test`, password: 'Passw0rd!187', organizationName: `Organización ${index}`, slug: `crm187-${index}`, registrationChoice: choice })
}
async function client(tenantId: string) {
  const rows = await admin`select * from records where entity_id = ${moduleId} and custom_data->>'organizacion_id' = ${tenantId}`
  expect(rows).toHaveLength(1)
  return rows[0]!
}
function subscription(tenantId: string, status = 'active', interval = 'month') {
  return { id: `sub_${tenantId}`, metadata: { tenantId }, status, customer: 'cus_simulated187', cancel_at_period_end: false, trial_end: status === 'trialing' ? 1800000000 : null, current_period_end: 1800000000, items: { data: [{ price: { id: interval === 'year' ? 'price187_year_starter' : 'price187_starter', recurring: { interval } } }] } } as Parameters<typeof billing.syncStripeSubscription>[0]
}
it('instala por simulación/--apply, idempotente y solo destino; no es Agenda ni plantilla pública', async () => {
  expect(await crm.installPlatformCrm()).toEqual({ enabled: true, installed: false })
  expect(await admin`select id from entities where slug = 'clientes'`).toHaveLength(0)
  expect(await crm.installPlatformCrm(true)).toEqual({ enabled: true, installed: true })
  expect(await crm.installPlatformCrm(true)).toEqual({ enabled: true, installed: true })
  const modules = await admin`select * from entities where slug = 'clientes'`
  expect(modules).toHaveLength(1)
  expect(modules[0]).toMatchObject({ tenant_id: destination, name: 'Clientes', singular_name: 'Cliente', icon: 'Building2', template_key: null })
  moduleId = modules[0]!.id
  expect(await admin`select id from role_entity_permissions where entity_id = ${moduleId} and can_read and can_create and can_update and can_delete`).toHaveLength(1)
})
it('desactivada, slug inexistente y autoexclusión no escriben', async () => {
  const a = await account()
  delete process.env.PLATFORM_CRM_TENANT_SLUG
  expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('skipped')
  process.env.PLATFORM_CRM_TENANT_SLUG = 'inexistente187'
  expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('skipped')
  process.env.PLATFORM_CRM_TENANT_SLUG = 'platform187'
  expect((await crm.syncPlatformClient(destination)).status).toBe('skipped')
})
it('scripts reales son read-only por omisión, aceptan entorno inyectado y resumen sin identidad', async () => {
  const before = await admin`select count(*)::int as count from records`
  const run = (script: string, args: string[] = []) => JSON.parse(execFileSync(process.execPath, [resolve(__dirname, '../../scripts', script), ...args], { env: { ...process.env, DATABASE_URL: fixture.adminUrl, APP_DATABASE_URL: fixture.appUrl, DB_POOL_MAX: '1' }, encoding: 'utf8', timeout: 30_000 }).trim()) as Record<string, unknown>
  expect(run('installPlatformCrm.mjs')).toEqual({ apply: false, enabled: true, installed: true })
  expect(run('installPlatformCrm.mjs', ['--apply'])).toEqual({ apply: true, enabled: true, installed: true })
  expect(run('syncPlatformClients.mjs')).toMatchObject({ apply: false, errors: 0, incomplete: false })
  expect(await admin`select count(*)::int as count from records`).toEqual(before)
  expect(run('syncPlatformClients.mjs', ['--apply'])).toMatchObject({ apply: true, errors: 0, incomplete: false })
  expect((await admin`select count(*)::int as count from records`)[0]!.count).toBeGreaterThan(before[0]!.count)
}, 120_000)
it('alta, UTM, idempotencia, diff de un campo y campos manuales/propios intactos', async () => {
  const a = await account({ plan: 'starter', interval: 'year', utm_source: 'landing', ref: 'campana' })
  expect((await crm.syncPlatformClient(a.tenantId, { apply: false })).status).toBe('created')
  expect(await admin`select id from records where custom_data->>'organizacion_id' = ${a.tenantId}`).toHaveLength(0)
  expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('created')
  const first = await client(a.tenantId)
  expect(first.custom_data).toMatchObject({ estado: 'Prospecto', usuarios: 1, modulos: 0, mrr: '0.00', correo: `crm187-${index}@local.test`, fuente: 'plan=starter; interval=year; utm_source=landing; ref=campana' })
  expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('unchanged')
  expect((await client(a.tenantId)).updated_at).toEqual(first.updated_at)
  await admin`update records set custom_data = custom_data || '{"notas":"Conservar","contacto":"Responsable","telefono":"123","propio":"intacto"}' where id = ${first.id}`
  await admin`update tenants set name = 'Nombre nuevo' where id = ${a.tenantId}`
  expect(await crm.syncPlatformClient(a.tenantId)).toEqual({ status: 'updated', fields: ['nombre'] })
  expect((await client(a.tenantId)).custom_data).toMatchObject({ notas: 'Conservar', contacto: 'Responsable', telefono: '123', propio: 'intacto' })
})
it('concurrencia real y aislamiento RLS tanto de metadatos como registros/escrituras', async () => {
  const a = await account()
  const results = await Promise.all([crm.syncPlatformClient(a.tenantId), crm.syncPlatformClient(a.tenantId)])
  expect(results.map(r => r.status).sort()).toEqual(['created', 'unchanged'])
  const row = await client(a.tenantId)
  await app.begin(async tx => {
    await tx`select set_config('app.tenant_id', ${a.tenantId}, true), set_config('app.person_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.record_system', 'on', true)`
    expect(await tx`select id from entities where id = ${moduleId}`).toHaveLength(0)
    expect(await tx`select id from records where id = ${row.id}`).toHaveLength(0)
    expect(await tx`update records set custom_data = '{}' where id = ${row.id} returning id`).toHaveLength(0)
    expect(await tx`select * from platform_crm_events`).toHaveLength(0)
  })
  await expect(app.begin(async tx => {
    await tx`select set_config('app.tenant_id', ${a.tenantId}, true), set_config('app.record_system', 'on', true)`
    await tx`insert into records (tenant_id, entity_id, custom_data) values (${destination}, ${moduleId}, '{}')`
  })).rejects.toThrow()
})
it('Stripe simulado: prueba, pago, impago, cancelación; MRR mensual/anual/manual y fuente duradera', async () => {
  const a = await account({ plan: 'starter', interval: 'year', utm_medium: 'email' })
  await admin`update plans set monthly_price_cents = 150000, annual_price_cents = 1200000 where key = 'starter'`
  for (const [status, expected] of [['trialing', 'En prueba'], ['active', 'Activo'], ['past_due', 'Impago'], ['unpaid', 'Impago'], ['canceled', 'Cancelado']]) {
    await billing.syncStripeSubscription(subscription(a.tenantId, status))
    await crm.syncPlatformClient(a.tenantId)
    expect((await client(a.tenantId)).custom_data).toMatchObject({ estado: expected, mrr: status === 'canceled' ? '0.00' : '1500.00', fuente: 'plan=starter; interval=year; utm_medium=email' })
  }
  await billing.syncStripeSubscription(subscription(a.tenantId, 'active', 'year'))
  await crm.syncPlatformClient(a.tenantId)
  expect((await client(a.tenantId)).custom_data).toMatchObject({ intervalo: 'Anual', mrr: '1000.00' })
  const [beforePayment] = await admin`select generation from platform_crm_events where tenant_id = ${a.tenantId}`
  simulation.event = { id: 'evt_invoice187', type: 'invoice.paid', data: { object: { id: 'in_simulated187', metadata: { tenantId: a.tenantId }, parent: null, status: 'paid', currency: 'mxn', subtotal: 1200000, total: 1200000, amount_paid: 1200000, period_start: 1790000000, period_end: 1800000000, created: 1790000000, due_date: null, status_transitions: { paid_at: 1790000000 }, hosted_invoice_url: null, invoice_pdf: null, number: 'SIMULATED187', customer: 'cus_simulated187' } } }
  const webhook = (await import('../../server/api/billing/webhook.post')).default
  await expect(webhook({} as Parameters<typeof webhook>[0])).resolves.toEqual({ received: true })
  const [afterPayment] = await admin`select generation from platform_crm_events where tenant_id = ${a.tenantId}`
  expect(afterPayment!.generation).not.toBe(beforePayment!.generation)
  expect(await admin`select id from tenant_billing_invoices where tenant_id = ${a.tenantId} and status = 'paid'`).toHaveLength(1)
  await admin`update tenant_subscriptions set provider = 'manual' where tenant_id = ${a.tenantId}`
  await crm.syncPlatformClient(a.tenantId)
  expect((await client(a.tenantId)).custom_data.mrr).toBe('0.00')
  await admin`update tenant_subscriptions set provider = 'stripe' where tenant_id = ${a.tenantId}`
  await admin`update plans set annual_price_cents = 0 where key = 'starter'`
  await crm.syncPlatformClient(a.tenantId)
  expect((await client(a.tenantId)).custom_data.mrr).toBe('0.00')
})
it('otros orígenes, validación dinámica y reparaciones de borrado lógico', async () => {
  const a = await account()
  await crm.syncPlatformClient(a.tenantId)
  const row = await client(a.tenantId)
  for (const origen of ['desarrollo', 'otro']) {
    await admin`update records set custom_data = custom_data || ${admin.json({ origen, nombre: 'Manual' })} where id = ${row.id}`
    expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('skipped')
    expect((await client(a.tenantId)).custom_data.nombre).toBe('Manual')
  }
  await admin`update records set custom_data = custom_data || '{"origen":"flow_saas"}', deleted_at = now() where id = ${row.id}`
  expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('updated')
  expect((await client(a.tenantId)).deleted_at).toBeNull()
  await admin`update entity_fields set validation_rules = '{"maxLength":2}' where entity_id = ${moduleId} and name = 'nombre'`
  await expect(crm.syncPlatformClient(a.tenantId)).rejects.toThrow()
  await admin`update entity_fields set validation_rules = '{"notBlank":true}' where entity_id = ${moduleId} and name = 'nombre'`
})
it('respaldo manual no concede plan; sin suscripción vigente es Cancelado; métricas activas y correo propietario', async () => {
  const a = await account()
  await billing.getTenantSubscription(a.tenantId)
  await crm.syncPlatformClient(a.tenantId)
  expect((await client(a.tenantId)).custom_data).toMatchObject({ estado: 'Prospecto', plan: null, mrr: '0.00' })
  await admin`update tenants set onboarding_status = 'complete', email = 'negocio@local.test' where id = ${a.tenantId}`
  await admin`delete from tenant_subscriptions where tenant_id = ${a.tenantId}`
  await admin`insert into entities (tenant_id, name, slug, is_active) values (${a.tenantId}, 'Activo', 'activo187', true), (${a.tenantId}, 'Inactivo', 'inactivo187', false)`
  await crm.syncPlatformClient(a.tenantId)
  expect((await client(a.tenantId)).custom_data).toMatchObject({ estado: 'Cancelado', modulos: 1, usuarios: 1, correo: `crm187-${index}@local.test` })
  await admin`update users set is_active = false where id = ${a.userId}`
  await crm.syncPlatformClient(a.tenantId)
  expect((await client(a.tenantId)).custom_data.usuarios).toBe(0)
})
it('eliminación capturada conserva cliente y notas y escribe fecha_baja; también elimina antes del primer sync', async () => {
  const a = await account(), b = await account()
  const bOwner = `crm187-${index}@local.test`
  await admin`update tenants set email = 'negocio@local.test' where id = ${b.tenantId}`
  await crm.syncPlatformClient(a.tenantId)
  const row = await client(a.tenantId)
  await admin`update records set custom_data = custom_data || '{"notas":"No borrar"}' where id = ${row.id}`
  await admin`delete from tenants where id in (${a.tenantId}, ${b.tenantId})`
  const events = await admin`select * from platform_crm_events where tenant_id in (${a.tenantId}, ${b.tenantId})`
  expect(events).toHaveLength(2)
  for (const event of events) {
    const outcome = await queue.handlePlatformCrmJob({ id: 'test', tenantId: destination, kind: 'platform_crm', payload: { tenantId: event.tenant_id, ...event.payload }, attempts: 1, maxAttempts: 6 })
    expect(outcome).toEqual({ ok: true })
    expect((await client(event.tenant_id)).custom_data).toMatchObject({ estado: 'Cancelado', mrr: '0.00', fecha_baja: expect.any(String) })
  }
  expect((await client(a.tenantId)).custom_data.notas).toBe('No borrar')
  expect((await client(b.tenantId)).custom_data.correo).toBe(bOwner)
  expect((await crm.syncPlatformClient(a.tenantId)).status).toBe('unchanged')
})
it('administración, refresco diario, sesiones y fallos parciales se encolan y reintentan', async () => {
  const a = await account(), bad = await account()
  await admin`update tenants set name = '' where id = ${bad.tenantId}`
  const { saveTenantOverride } = await import('../../server/utils/plans')
  await saveTenantOverride({ tenantId: a.tenantId, concept: 'users', value: 10, reason: 'Prueba simulada', validFrom: null, validUntil: null })
  expect(await admin`select tenant_id from platform_crm_events where tenant_id = ${a.tenantId}`).toHaveLength(1)
  await admin`insert into auth_sessions (tenant_id, user_id, expires_at, last_seen_at) values (${a.tenantId}, ${a.userId}, now() + interval '1 day', '2026-10-01T12:00:00Z')`
  expect((await queue.refreshPlatformCrm()).errors).toBe(0)
  jobs.registerJobHandler('platform_crm', queue.handlePlatformCrmJob)
  const tick = await jobs.runJobQueueTick({ budgetMs: 10_000, ratePerSecond: 0, perTenantLimit: 100, batchSize: 100, concurrency: 2 })
  expect(tick.succeeded).toBeGreaterThan(0)
  expect(tick.retried).toBeGreaterThan(0)
  expect((await client(a.tenantId)).custom_data.ultima_actividad).toBe('2026-10-01T12:00:00.000Z')
  expect(await admin`select id from job_queue where kind = 'platform_crm' and status = 'pending' and attempts > 0`).not.toHaveLength(0)
  await admin`update tenants set name = 'Reparado' where id = ${bad.tenantId}`
  expect((await crm.syncPlatformClients()).errors).toBe(0)
})
it('fallos de captura y sincronización no rompen registro, Checkout ni webhook real con Stripe simulado', async () => {
  await admin`alter table platform_crm_events rename to platform_crm_events_unavailable`
  try {
    const a = await account({ plan: 'starter', utm_source: 'landing' })
    await admin`update tenants set onboarding_status = 'plan_pending' where id = ${a.tenantId}`
    await expect(billing.createStripeCheckout(a.tenantId, 'starter', 'month')).resolves.toMatchObject({ url: 'https://stripe.test/simulated187' })
    simulation.event = { id: 'evt_simulated187', type: 'customer.subscription.created', data: { object: subscription(a.tenantId) } }
    const webhook = (await import('../../server/api/billing/webhook.post')).default
    await expect(webhook({} as Parameters<typeof webhook>[0])).resolves.toEqual({ received: true })
    await admin`update entities set is_active = false where id = ${moduleId}`
    expect(await queue.handlePlatformCrmJob({ id: 'test', tenantId: destination, kind: 'platform_crm', payload: { tenantId: a.tenantId }, attempts: 1, maxAttempts: 6 })).toMatchObject({ ok: false, retryable: true, error: 'No se pudo sincronizar el CRM' })
    simulation.event = { id: 'evt_simulated187b', type: 'customer.subscription.updated', data: { object: subscription(a.tenantId, 'past_due') } }
    await expect(webhook({} as Parameters<typeof webhook>[0])).resolves.toEqual({ received: true })
  } finally {
    await admin`alter table platform_crm_events_unavailable rename to platform_crm_events`
    await admin`update entities set is_active = true where id = ${moduleId}`
  }
  expect((await queue.refreshPlatformCrm()).errors).toBe(0)
})
