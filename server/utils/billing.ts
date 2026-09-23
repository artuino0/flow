import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import Stripe from 'stripe'
import { db, withTenant } from '~/server/db'
import { sites, subscriptionPlans, tenantBillingInvoices, tenantSubscriptions, tenants, tenantUsageSnapshots, triggerLogs, users } from '~/server/db/schema'

export type BillingInterval = 'month' | 'year'
export type UsageResource = 'storageBytes' | 'users' | 'sites' | 'automationExecutions' | 'emails'

export interface PlanLimits {
  storageBytes?: number
  users?: number
  sites?: number
  customDomains?: number
  automationExecutions?: number
  emails?: number
}

const usageResources: UsageResource[] = ['storageBytes', 'users', 'sites', 'automationExecutions', 'emails']
const asNumber = (value: string | number | bigint | null | undefined) => Number(value ?? 0)
const isoDate = (date = new Date()) => date.toISOString().slice(0, 10)
const periodStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)

export class BillingNotConfiguredError extends Error {}
export class PlanNotAvailableError extends Error {}

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) throw new BillingNotConfiguredError('Stripe aún no está configurado. Agrega STRIPE_SECRET_KEY en el servidor.')
  return new Stripe(secretKey)
}

export function stripeIsConfigured() { return Boolean(process.env.STRIPE_SECRET_KEY?.trim()) }

function normalizeLimits(value: unknown): PlanLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))) as PlanLimits
}

function planPriceId(plan: typeof subscriptionPlans.$inferSelect, interval: BillingInterval) {
  const suffix = interval === 'year' ? 'ANNUAL' : 'MONTHLY'
  const configured = process.env[`STRIPE_PRICE_${plan.code.toUpperCase()}_${suffix}`]?.trim()
  return configured || (interval === 'year' ? plan.stripeAnnualPriceId : plan.stripeMonthlyPriceId) || null
}
function serializedPlan(plan: typeof subscriptionPlans.$inferSelect) {
  return { ...plan, limits: normalizeLimits(plan.limits) }
}

export async function listPublicPlans() {
  const plans = await db.select().from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.isActive, true), eq(subscriptionPlans.isPublic, true)))
    .orderBy(asc(subscriptionPlans.sortOrder))
  return plans.map(serializedPlan)
}

export async function getTenantSubscription(tenantId: string) {
  return withTenant(tenantId, async tx => {
    const [row] = await tx.select({ subscription: tenantSubscriptions, plan: subscriptionPlans })
      .from(tenantSubscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, tenantId))
      .limit(1)
    return row ? { ...row.subscription, plan: serializedPlan(row.plan) } : null
  })
}

export async function getTenantUsage(tenantId: string) {
  const subscription = await getTenantSubscription(tenantId)
  const limit = subscription?.plan.limits ?? {}
  // Serialize the period boundary for postgres-js raw SQL parameters.
  const start = periodStart().toISOString()
  const usage = await withTenant(tenantId, async tx => {
    const rows = await tx.execute(sql`
      SELECT
        (SELECT storage_used_bytes FROM tenants WHERE id = ${tenantId}::uuid) AS storage_bytes,
        (SELECT COUNT(*) FROM users WHERE tenant_id = ${tenantId}::uuid AND is_active = true) AS users_count,
        (SELECT COUNT(*) FROM sites WHERE tenant_id = ${tenantId}::uuid) AS sites_count,
        (SELECT COUNT(*) FROM trigger_logs WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${start}) AS automation_executions
    `) as unknown as Array<Record<string, string | number | bigint | null>>
    const row = rows[0] ?? {}
    return {
      storageBytes: asNumber(row.storage_bytes),
      users: asNumber(row.users_count),
      sites: asNumber(row.sites_count),
      automationExecutions: asNumber(row.automation_executions),
      // El correo solo se cobrará cuando exista proveedor administrado de Flow.
      // SMTP propio sigue siendo infraestructura y cuota del tenant.
      emails: 0
    } satisfies Record<UsageResource, number>
  })

  return usageResources.map(resourceKey => {
    const value = usage[resourceKey]
    const limitValue = limit[resourceKey]
    const isUnlimited = !limitValue || limitValue <= 0
    return {
      resourceKey,
      quantity: value,
      limit: isUnlimited ? null : limitValue,
      percentUsed: isUnlimited ? null : Math.round((value / limitValue) * 1000) / 10,
      isOverLimit: !isUnlimited && value > limitValue
    }
  })
}

export async function captureTenantUsage(tenantId: string, capturedOn = isoDate()) {
  const [subscription, usage] = await Promise.all([getTenantSubscription(tenantId), getTenantUsage(tenantId)])
  await withTenant(tenantId, async tx => {
    for (const item of usage) {
      await tx.execute(sql`
        INSERT INTO tenant_usage_snapshots (tenant_id, subscription_id, resource_key, quantity, limit_value, captured_on, captured_at, source)
        VALUES (${tenantId}::uuid, ${subscription?.id ?? null}::uuid, ${item.resourceKey}, ${item.quantity}, ${item.limit}, ${capturedOn}::date, now(), 'daily')
        ON CONFLICT (tenant_id, resource_key, captured_on) DO UPDATE
          SET subscription_id = EXCLUDED.subscription_id,
              quantity = EXCLUDED.quantity,
              limit_value = EXCLUDED.limit_value,
              captured_at = now(),
              source = EXCLUDED.source
      `)
    }
  })
  return usage
}

export async function captureAllTenantUsage() {
  const rows = await db.select({ id: tenants.id }).from(tenants)
  const results = await Promise.allSettled(rows.map(({ id }) => captureTenantUsage(id)))
  return { captured: results.filter(row => row.status === 'fulfilled').length, failed: results.filter(row => row.status === 'rejected').length }
}

export async function getUsageHistory(tenantId: string, days = 90) {
  const since = new Date()
  since.setDate(since.getDate() - Math.max(1, Math.min(days, 365)))
  return withTenant(tenantId, tx => tx.select()
    .from(tenantUsageSnapshots)
    .where(and(eq(tenantUsageSnapshots.tenantId, tenantId), gte(tenantUsageSnapshots.capturedOn, isoDate(since))))
    .orderBy(asc(tenantUsageSnapshots.capturedOn)))
}

export async function getInvoiceHistory(tenantId: string, take = 24) {
  return withTenant(tenantId, tx => tx.select()
    .from(tenantBillingInvoices)
    .where(eq(tenantBillingInvoices.tenantId, tenantId))
    .orderBy(desc(tenantBillingInvoices.issuedAt), desc(tenantBillingInvoices.createdAt))
    .limit(Math.max(1, Math.min(take, 100))))
}

export async function getBillingOverview(tenantId: string) {
  const [subscription, usage, invoices, history] = await Promise.all([
    getTenantSubscription(tenantId), getTenantUsage(tenantId), getInvoiceHistory(tenantId, 12), getUsageHistory(tenantId, 30)
  ])
  return { stripeConfigured: stripeIsConfigured(), subscription, usage, invoices, usageHistory: history }
}

function stripeDate(seconds: number | null | undefined) { return seconds ? new Date(seconds * 1000) : null }

async function findPlanFromStripePrice(priceId: string | null | undefined) {
  if (!priceId) return null
  const plans = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true))
  return plans.find(plan => planPriceId(plan, 'month') === priceId || planPriceId(plan, 'year') === priceId) ?? null
}

export async function syncStripeSubscription(subscription: Stripe.Subscription, tenantId?: string | null) {
  const resolvedTenantId = tenantId ?? subscription.metadata.tenantId
  if (!resolvedTenantId) throw new Error('Stripe no entregó el tenant de la suscripción')
  const priceId = subscription.items.data[0]?.price.id ?? null
  const plan = await findPlanFromStripePrice(priceId)
  if (!plan) throw new Error('El Price ID de Stripe no está vinculado a ningún plan de Flow')
  const interval = subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'year' : 'month'
  await withTenant(resolvedTenantId, async tx => {
    await tx.insert(tenantSubscriptions).values({
      tenantId: resolvedTenantId,
      planId: plan.id,
      provider: 'stripe',
      status: subscription.status,
      billingInterval: interval,
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: stripeDate(subscription.current_period_start),
      currentPeriodEnd: stripeDate(subscription.current_period_end),
      trialEndsAt: stripeDate(subscription.trial_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date()
    }).onConflictDoUpdate({
      target: tenantSubscriptions.tenantId,
      set: {
        planId: plan.id, provider: 'stripe', status: subscription.status, billingInterval: interval,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id, stripePriceId: priceId,
        currentPeriodStart: stripeDate(subscription.current_period_start), currentPeriodEnd: stripeDate(subscription.current_period_end),
        trialEndsAt: stripeDate(subscription.trial_end), cancelAtPeriodEnd: subscription.cancel_at_period_end, updatedAt: new Date()
      }
    })
    await tx.execute(sql`UPDATE tenants SET storage_limit_bytes = ${Number((normalizeLimits(plan.limits).storageBytes) || 0)} WHERE id = ${resolvedTenantId}::uuid`)
  })
  return getTenantSubscription(resolvedTenantId)
}

export async function syncStripeInvoice(invoice: Stripe.Invoice, tenantId?: string | null) {
  const subscriptionRef = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  let resolvedTenantId = tenantId ?? invoice.metadata.tenantId ?? null
  let subscription = null as Awaited<ReturnType<typeof getTenantSubscription>>
  if (!resolvedTenantId && subscriptionRef) {
    const [row] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.stripeSubscriptionId, subscriptionRef)).limit(1)
    resolvedTenantId = row?.tenantId ?? null
  }
  if (!resolvedTenantId) throw new Error('No se pudo asociar la factura de Stripe con un tenant')
  subscription = await getTenantSubscription(resolvedTenantId)
  await withTenant(resolvedTenantId, tx => tx.insert(tenantBillingInvoices).values({
    tenantId: resolvedTenantId,
    subscriptionId: subscription?.id ?? null,
    provider: 'stripe',
    providerInvoiceId: invoice.id,
    status: invoice.status ?? 'open',
    currency: invoice.currency.toUpperCase(),
    subtotalCents: invoice.subtotal ?? 0,
    totalCents: invoice.total ?? 0,
    amountPaidCents: invoice.amount_paid ?? 0,
    periodStart: stripeDate(invoice.period_start), periodEnd: stripeDate(invoice.period_end),
    issuedAt: stripeDate(invoice.created), dueAt: stripeDate(invoice.due_date), paidAt: stripeDate(invoice.status_transitions?.paid_at),
    hostedInvoiceUrl: invoice.hosted_invoice_url, invoicePdfUrl: invoice.invoice_pdf,
    providerData: { number: invoice.number, customer: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id },
    updatedAt: new Date()
  }).onConflictDoUpdate({
    target: [tenantBillingInvoices.provider, tenantBillingInvoices.providerInvoiceId],
    set: {
      status: invoice.status ?? 'open', subtotalCents: invoice.subtotal ?? 0, totalCents: invoice.total ?? 0,
      amountPaidCents: invoice.amount_paid ?? 0, paidAt: stripeDate(invoice.status_transitions?.paid_at),
      hostedInvoiceUrl: invoice.hosted_invoice_url, invoicePdfUrl: invoice.invoice_pdf, updatedAt: new Date()
    }
  }))
}

export async function createStripeCheckout(tenantId: string, planCode: string, interval: BillingInterval) {
  const stripe = getStripeClient()
  const [plan] = await db.select().from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.code, planCode), eq(subscriptionPlans.isActive, true), eq(subscriptionPlans.isPublic, true)))
    .limit(1)
  if (!plan) throw new PlanNotAvailableError('El plan seleccionado no está disponible')
  const priceId = planPriceId(plan, interval)
  if (!priceId) throw new BillingNotConfiguredError(`Falta vincular el precio ${interval === 'year' ? 'anual' : 'mensual'} de ${plan.name} en Stripe`)
  const [tenant] = await db.select({ name: tenants.name, email: tenants.email }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!tenant) throw new Error('Espacio de trabajo no encontrado')
  const current = await getTenantSubscription(tenantId)
  const customerId = current?.stripeCustomerId || (await stripe.customers.create({ name: tenant.name, email: tenant.email ?? undefined, metadata: { tenantId } })).id
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer: customerId, line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/ajustes?section=plan&success=1`, cancel_url: `${baseUrl}/ajustes?section=plan&canceled=1`,
    metadata: { tenantId, planCode }, subscription_data: { metadata: { tenantId, planCode } }
  })
  if (!session.url) throw new Error('Stripe no devolvió una URL de checkout')
  return { url: session.url }
}

export async function createStripePortal(tenantId: string) {
  const current = await getTenantSubscription(tenantId)
  if (!current?.stripeCustomerId) throw new BillingNotConfiguredError('Este espacio de trabajo todavía no tiene un cliente de Stripe')
  const stripe = getStripeClient()
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')
  const session = await stripe.billingPortal.sessions.create({ customer: current.stripeCustomerId, return_url: `${baseUrl}/ajustes?section=plan` })
  return { url: session.url }
}
