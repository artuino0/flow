import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createTestDb, type TestDb } from '../setup/testDb'

const state = vi.hoisted(() => ({ tenantId: '', planCode: '' }))

vi.mock('stripe', () => ({
  default: class {
    customers = { create: async () => ({ id: 'cus_test' }) }
    checkout = { sessions: { create: async () => ({ url: 'https://checkout.stripe.test/session' }) } }
  }
}))
vi.mock('../../server/utils/rbac', () => ({ requireAdminRole: async () => ({ tenantId: state.tenantId }) }))

let testDb: TestDb
let admin: postgres.Sql
let getPlanUsage: typeof import('../../server/utils/billing').getPlanUsage
let getAvailablePlansForTenant: typeof import('../../server/utils/billing').getAvailablePlansForTenant
let syncStripeSubscription: typeof import('../../server/utils/billing').syncStripeSubscription
let syncStripeInvoice: typeof import('../../server/utils/billing').syncStripeInvoice
let checkout: (event: unknown) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('createError', (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'Error')), options))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', async () => ({ planCode: state.planCode, interval: 'month' }))
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.APP_DATABASE_URL = testDb.appUrl
  process.env.PLAN_CACHE_TTL_MS = '0'
  process.env.STRIPE_SECRET_KEY = 'sk_test_billing_plan_changes'
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter'
  process.env.STRIPE_PRICE_CRECIMIENTO_MONTHLY = 'price_crecimiento'
  process.env.STRIPE_PRICE_AGENDA_MONTHLY = 'price_agenda'
  ;({ getPlanUsage, getAvailablePlansForTenant, syncStripeSubscription, syncStripeInvoice } = await import('../../server/utils/billing'))
  checkout = (await import('../../server/api/billing/checkout.post')).default as typeof checkout
}, 120_000)

afterAll(async () => {
  if (admin) await admin.end()
  if (testDb) await testDb.stop()
  for (const key of ['APP_DATABASE_URL', 'PLAN_CACHE_TTL_MS', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_CRECIMIENTO_MONTHLY', 'STRIPE_PRICE_AGENDA_MONTHLY']) delete process.env[key]
  vi.unstubAllGlobals()
})

async function tenantOn(planCode: string) {
  const tenantId = randomUUID()
  await admin`insert into tenants (id, name) values (${tenantId}, ${'ERD104 ' + tenantId})`
  await getPlanUsage(tenantId)
  await admin`update tenant_subscriptions set plan_id = (select id from plans where key = ${planCode}) where tenant_id = ${tenantId}`
  state.tenantId = tenantId
  return tenantId
}

function stripeSubscription(tenantId: string, priceId: string) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `sub_${tenantId}`,
    metadata: { tenantId },
    items: { data: [{ price: { id: priceId, recurring: { interval: 'month' } } }] },
    customer: 'cus_test',
    status: 'active',
    current_period_start: now,
    current_period_end: now + 30 * 24 * 60 * 60,
    trial_end: null,
    cancel_at_period_end: false
  } as Parameters<typeof syncStripeSubscription>[0]
}

function stripeInvoice(tenantId: string, subscriptionId: string): Parameters<typeof syncStripeInvoice>[0] {
  return {
    id: `in_${tenantId}`,
    metadata: null,
    parent: { type: 'subscription_details', quote_details: null, subscription_details: { subscription: subscriptionId, metadata: { tenantId } } },
    status: 'paid', currency: 'mxn', subtotal: 100, total: 100, amount_paid: 100,
    period_start: 1_700_000_000, period_end: 1_702_592_000, created: 1_700_000_000,
    due_date: null, status_transitions: { finalized_at: null, marked_uncollectible_at: null, paid_at: 1_700_000_000, voided_at: null },
    hosted_invoice_url: null, invoice_pdf: null, number: 'INV-107', customer: 'cus_test'
  }
}

describe('cambio de plan en checkout', () => {
  it('permite bajar cuando todos los consumos caben y permite subir', async () => {
    await tenantOn('crecimiento')
    state.planCode = 'starter'
    await expect(checkout({})).resolves.toEqual({ url: 'https://checkout.stripe.test/session' })
    await tenantOn('starter')
    state.planCode = 'crecimiento'
    await expect(checkout({})).resolves.toEqual({ url: 'https://checkout.stripe.test/session' })
  })

  it('rechaza con 409 bajar cuando un concepto excede el plan destino', async () => {
    const tenantId = await tenantOn('crecimiento')
    await admin`update plan_limits set value = 0 where plan_id = (select id from plans where key = 'starter') and concept = 'modules'`
    await admin`insert into entities (tenant_id, name, slug, module_kind) values (${tenantId}, 'Módulo de prueba', 'modulo-prueba', 'hecho')`
    const starter = (await getAvailablePlansForTenant(tenantId)).find(plan => plan.code === 'starter')
    expect(starter?.blockedBy).toEqual(expect.arrayContaining([expect.objectContaining({ concept: 'modules', used: 1, limit: 0 })]))
    state.planCode = 'starter'
    await expect(checkout({})).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringMatching(/Módulos personalizados.*Contacta a soporte/) })
  })

  it('oculta Agenda y rechaza su checkout para quien nunca lo tuvo', async () => {
    const tenantId = await tenantOn('starter')
    expect((await getAvailablePlansForTenant(tenantId)).map(plan => plan.code)).not.toContain('agenda')
    state.planCode = 'agenda'
    await expect(checkout({})).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringMatching(/Agenda/) })
  })

  it('muestra Agenda a quien lo tiene actualmente', async () => {
    const tenantId = await tenantOn('agenda')
    expect((await getAvailablePlansForTenant(tenantId)).map(plan => plan.code)).toContain('agenda')
  })

  it('registra el alta y los cambios del webhook sin duplicar un mismo plan', async () => {
    const tenantId = await tenantOn('starter')
    await syncStripeSubscription(stripeSubscription(tenantId, 'price_crecimiento'))
    await syncStripeSubscription(stripeSubscription(tenantId, 'price_crecimiento'))
    const history = await admin`select p.key, h.source, h.ended_at from tenant_plan_history h
      join plans p on p.id = h.plan_id where h.tenant_id = ${tenantId} order by h.started_at, h.id`
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ key: 'starter' })
    expect(history[0]!.ended_at).not.toBeNull()
    expect(history[1]).toMatchObject({ key: 'crecimiento', source: 'stripe_webhook', ended_at: null })
  })

  it('conserva el periodo raíz anterior y acepta el periodo del item actual', async () => {
    const tenantId = await tenantOn('starter')
    const payload = stripeSubscription(tenantId, 'price_crecimiento')
    payload.current_period_start = 1_700_000_000
    payload.current_period_end = 1_702_592_000
    payload.items.data[0]!.current_period_start = 1_710_000_000
    payload.items.data[0]!.current_period_end = 1_712_592_000
    await syncStripeSubscription(payload)

    const [legacy] = await admin`select current_period_start, current_period_end from tenant_subscriptions where tenant_id = ${tenantId}`
    expect(legacy!.current_period_start).toEqual(new Date(1_700_000_000_000))
    expect(legacy!.current_period_end).toEqual(new Date(1_702_592_000_000))

    delete payload.current_period_start
    delete payload.current_period_end
    await syncStripeSubscription(payload)
    const [current] = await admin`select current_period_start, current_period_end from tenant_subscriptions where tenant_id = ${tenantId}`
    expect(current!.current_period_start).toEqual(new Date(1_710_000_000_000))
    expect(current!.current_period_end).toEqual(new Date(1_712_592_000_000))
  })

  it('asocia la factura actual mediante la metadata de la suscripción padre', async () => {
    const tenantId = await tenantOn('starter')
    const payload = stripeSubscription(tenantId, 'price_crecimiento')
    await syncStripeSubscription(payload)
    const invoice = stripeInvoice(tenantId, payload.id)

    await syncStripeInvoice(invoice)
    const [stored] = await admin`select tenant_id, provider_invoice_id from tenant_billing_invoices where provider_invoice_id = ${invoice.id}`
    expect(stored).toMatchObject({ tenant_id: tenantId, provider_invoice_id: invoice.id })
  })

  it('explica el fallo si la factura no incluye ningún tenant', async () => {
    const invoice = stripeInvoice(randomUUID(), 'sub_without_tenant')
    invoice.parent!.subscription_details!.metadata = null
    await expect(syncStripeInvoice(invoice)).rejects.toThrow('No se pudo asociar la factura de Stripe con un tenant')
  })

  it('permite volver a Agenda tras cambiar a Starter si el consumo cabe', async () => {
    const tenantId = await tenantOn('agenda')
    await syncStripeSubscription(stripeSubscription(tenantId, 'price_starter'))
    const agenda = (await getAvailablePlansForTenant(tenantId)).find(plan => plan.code === 'agenda')
    expect(agenda).toBeDefined()
    expect(agenda?.blockedBy).toEqual([])
    state.planCode = 'agenda'
    await expect(checkout({})).resolves.toEqual({ url: 'https://checkout.stripe.test/session' })
  })

  it('expresa el almacenamiento en GB en el rechazo 409', async () => {
    const tenantId = await tenantOn('crecimiento')
    await admin`update tenants set storage_used_bytes = ${6 * 1024 ** 3} where id = ${tenantId}`
    state.planCode = 'starter'
    await expect(checkout({})).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringMatching(/Almacenamiento \(6 GB de 5 GB\)/) })
  })

  it('restringe la lectura del historial al tenant activo mediante RLS', async () => {
    const first = await tenantOn('starter')
    const second = await tenantOn('starter')
    const app = postgres(testDb.appUrl)
    try {
      await app.begin(async tx => {
        await tx`select set_config('app.tenant_id', ${first}, true)`
        const rows = await tx`select tenant_id from tenant_plan_history`
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every(row => row.tenant_id === first)).toBe(true)
        expect(rows.some(row => row.tenant_id === second)).toBe(false)
      })
    } finally {
      await app.end()
    }
  })

  it('reconstruye el historial de la suscripción vigente mediante el backfill', async () => {
    const tenantId = await tenantOn('starter')
    await admin`delete from tenant_plan_history where tenant_id = ${tenantId}`
    const migration = fs.readFileSync(new URL('../../server/db/migrations/0080_tenant_plan_history.sql', import.meta.url), 'utf8')
    await admin.unsafe(migration)
    const history = await admin`select p.key, h.source, h.ended_at from tenant_plan_history h
      join plans p on p.id = h.plan_id where h.tenant_id = ${tenantId}`
    expect(history).toEqual([expect.objectContaining({ key: 'starter', source: 'backfill', ended_at: null })])
  })
})
