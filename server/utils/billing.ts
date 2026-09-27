import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import Stripe from 'stripe'
import { db, withTenant } from '~/server/db'
import { effectiveStorageLimit, getEffectivePlanLimits, getPlanByKey, listPlans, type PlanConcept, type PlanLimits } from '~/server/utils/plans'
import { getLicenseStatus, IS_ONPREM_BUILD } from '~/server/utils/license'
import { sites, subscriptionPlans, tenantBillingInvoices, tenantPlanHistory, tenantSubscriptions, tenants, tenantUsageSnapshots, triggerLogs, users } from '~/server/db/schema'

export type BillingInterval = 'month' | 'year'
export type UsageResource = 'storageBytes' | 'users' | 'sites' | 'automationExecutions' | 'emails'

const usageResources: UsageResource[] = ['storageBytes', 'users', 'sites', 'automationExecutions', 'emails']
const asNumber = (value: string | number | bigint | null | undefined) => Number(value ?? 0)
const isoDate = (date = new Date()) => date.toISOString().slice(0, 10)
const periodStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
function formatStorage(bytes: number) {
  if (bytes === 0) return '0 MB'
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes >= 1024 ** 3 ? 'GB' : bytes >= 1024 ** 2 ? 'MB' : 'KB'
  const divisor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(bytes / divisor)} ${unit}`
}
function formatUsageValue(item: PlanUsageItem, value: number) {
  return item.concept === 'storageBytes' ? formatStorage(value) : value.toLocaleString('es-MX')
}

export class BillingNotConfiguredError extends Error {}
export class PlanNotAvailableError extends Error {}
export class PlanChangeNotAllowedError extends Error {}

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) throw new BillingNotConfiguredError('Stripe aún no está configurado. Agrega STRIPE_SECRET_KEY en el servidor.')
  return new Stripe(secretKey)
}

export function stripeIsConfigured() { return Boolean(process.env.STRIPE_SECRET_KEY?.trim()) }

function planPriceId(plan: typeof subscriptionPlans.$inferSelect, interval: BillingInterval) {
  const suffix = interval === 'year' ? 'ANNUAL' : 'MONTHLY'
  const configured = process.env[`STRIPE_PRICE_${plan.code.toUpperCase()}_${suffix}`]?.trim()
  return configured || (interval === 'year' ? plan.stripeAnnualPriceId : plan.stripeMonthlyPriceId) || null
}
export async function listPublicPlans() {
  return (await listPlans()).filter(plan => plan.isActive && plan.isPublic)
}

export async function getAvailablePlansForTenant(tenantId: string) {
  const [current, plans] = await Promise.all([getTenantSubscription(tenantId), listPublicPlans()])
  const agenda = plans.find(plan => plan.code === 'agenda')
  let hadAgenda = current?.plan.code === 'agenda'
  if (!hadAgenda && agenda) {
    const history = await withTenant(tenantId, tx => tx.select({ id: tenantPlanHistory.id })
      .from(tenantPlanHistory)
      .where(and(eq(tenantPlanHistory.tenantId, tenantId), eq(tenantPlanHistory.planId, agenda.id)))
      .limit(1))
    hadAgenda = history.length > 0
  }
  const visible = plans.filter(plan => plan.code !== 'agenda' || hadAgenda)
  const usage = current && visible.some(plan => plan.sortOrder < current.plan.sortOrder)
    ? (await getPlanUsage(tenantId)).usage
    : []
  return Promise.all(visible.map(async plan => {
    if (!current || plan.sortOrder >= current.plan.sortOrder) return { ...plan, blockedBy: [] as Array<PlanUsageItem & { limit: number }> }
    const limits = await getEffectivePlanLimits(tenantId, plan.id)
    const blockedBy = usage.flatMap(item => {
      const limit = limits[item.concept]
      return limit !== null && item.used > limit ? [{ ...item, limit }] : []
    })
    return { ...plan, blockedBy }
  }))
}

export async function getTenantSubscription(tenantId: string): Promise<({ id: string; tenantId: string; planId: string; provider: string; status: string; billingInterval: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; stripePriceId: string | null; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; trialEndsAt: Date | null; cancelAtPeriodEnd: boolean; createdAt: Date; updatedAt: Date } & { plan: (typeof subscriptionPlans.$inferSelect & { limits: PlanLimits }) }) | null> {
  const row = await withTenant(tenantId, async tx => {
    const [row] = await tx.select({ subscription: tenantSubscriptions, plan: subscriptionPlans })
      .from(tenantSubscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, tenantId))
      .limit(1)
    return row ?? null
  })
  if (!row) {
    const starter = await getPlanByKey('starter')
    if (!starter) throw new Error('Falta el plan Starter en la base de datos; aplica la migración ERD-100')
    const effective = await getEffectivePlanLimits(tenantId, starter.id)
    await withTenant(tenantId, async tx => {
      await tx.insert(tenantSubscriptions).values({ tenantId, planId: starter.id, provider: 'manual', status: 'trialing', billingInterval: 'month', currentPeriodStart: new Date() }).onConflictDoNothing()
      await tx.execute(sql`UPDATE tenants SET storage_limit_bytes = ${effectiveStorageLimit(effective.storageBytes)}::bigint WHERE id = ${tenantId}::uuid`)
    })
    return getTenantSubscription(tenantId)
  }
  const limits = await getEffectivePlanLimits(tenantId, row.plan.id)
  return { ...row.subscription, plan: { ...row.plan, limits } }
}

export async function getTenantUsage(tenantId: string) {
  const subscription = await getTenantSubscription(tenantId)
  if (!subscription) throw new Error('No se pudo asignar el plan Starter a la organización')
  const limit = subscription.plan.limits
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
    const concept: Record<UsageResource, PlanConcept> = { storageBytes: 'storageBytes', users: 'users', sites: 'sites', automationExecutions: 'executions', emails: 'emails' }
    const limitValue = limit[concept[resourceKey]]
    const isUnlimited = limitValue === null || limitValue === undefined
    return {
      resourceKey,
      quantity: value,
      limit: isUnlimited ? null : limitValue,
      percentUsed: isUnlimited ? null : limitValue === 0 ? (value > 0 ? 100 : 0) : Math.round((value / limitValue) * 1000) / 10,
      isOverLimit: !isUnlimited && value > limitValue
    }
  })
}

export interface PlanUsageItem { concept: PlanConcept; label: string; used: number; limit: number | null; percent: number | null }
export async function getPlanUsage(tenantId: string): Promise<{ plan: string; code: string; usage: PlanUsageItem[] }> {
  const subscription = await getTenantSubscription(tenantId)
  if (!subscription) throw new Error('No se pudo asignar el plan Starter a la organización')
  const limits = licensedOnPremLimits(subscription.plan.limits)
  const plan = subscription.plan
  const rows = await withTenant(tenantId, tx => tx.execute(sql`
    WITH period AS (
      SELECT date_trunc('month', now() AT TIME ZONE timezone) AT TIME ZONE timezone AS start_at
      FROM tenants WHERE id = ${tenantId}::uuid
    )
    SELECT
      (SELECT count(*) FROM users WHERE tenant_id = ${tenantId}::uuid AND (is_active OR invitation_token_hash IS NOT NULL)) AS users,
      (SELECT count(*) FROM entities WHERE tenant_id = ${tenantId}::uuid AND module_kind <> 'dimension' AND deleted_at IS NULL) AS modules,
      (SELECT count(*) FROM triggers WHERE tenant_id = ${tenantId}::uuid AND is_active) AS flows,
      (SELECT count(*) FROM trigger_logs WHERE tenant_id = ${tenantId}::uuid AND created_at >= (SELECT start_at FROM period)) AS executions,
      (SELECT count(*) FROM job_queue WHERE tenant_id = ${tenantId}::uuid AND kind = 'email' AND created_at >= (SELECT start_at FROM period)) AS emails,
      (SELECT storage_used_bytes FROM tenants WHERE id = ${tenantId}::uuid) AS storage,
      (SELECT count(*) FROM cfdi_documents WHERE tenant_id = ${tenantId}::uuid AND estado = 'timbrada' AND fecha_timbrado >= (SELECT start_at FROM period)) AS stamps,
      (SELECT count(*) FROM sites WHERE tenant_id = ${tenantId}::uuid) AS sites,
      (SELECT count(*) FROM site_pages p JOIN sites s ON s.id = p.site_id WHERE s.tenant_id = ${tenantId}::uuid) AS pages,
      (SELECT count(*) FROM site_form_connections WHERE tenant_id = ${tenantId}::uuid) AS forms,
      (SELECT count(*) FROM site_form_submissions WHERE tenant_id = ${tenantId}::uuid AND created_at >= (SELECT start_at FROM period)) AS submissions
  `)) as unknown as Array<Record<string, string | number | bigint | null>>
  const row = rows[0] ?? {}
  const definitions: Array<[PlanConcept, string, number | null]> = [
    ['users', 'Usuarios', limits.users], ['modules', 'Módulos personalizados', limits.modules], ['activeFlows', 'Flujos activos', limits.activeFlows],
    ['executions', 'Ejecuciones mensuales', limits.executions], ['emails', 'Correos mensuales', limits.emails], ['storageBytes', 'Almacenamiento', limits.storageBytes],
    ['stamps', 'Timbres mensuales', limits.stamps], ['sites', 'Sitios', limits.sites], ['pages', 'Páginas', limits.pages], ['forms', 'Formularios', limits.forms], ['formSubmissions', 'Envíos de formulario', limits.formSubmissions]
  ]
  return { plan: plan.name, code: plan.code, usage: definitions.map(([concept, label, limit]) => {
    const column: Record<PlanConcept, string> = { users: 'users', usersIncluded: 'users', modules: 'modules', activeFlows: 'flows', executions: 'executions', emails: 'emails', storageBytes: 'storage', stamps: 'stamps', sites: 'sites', pages: 'pages', forms: 'forms', formSubmissions: 'submissions' }
    const used = asNumber(row[column[concept]])
    return { concept, label, used, limit, percent: limit === null ? null : limit === 0 ? (used > 0 ? 100 : 0) : Math.round(used / limit * 1000) / 10 }
  }) }
}

function licensedOnPremLimits(limits?: Record<string, number | null>) {
  const result = { ...(limits ?? {}) }
  if (IS_ONPREM_BUILD && getLicenseStatus().activated) for (const concept of ['users','modules','activeFlows','executions','emails','storageBytes','stamps','sites','pages','forms','formSubmissions']) result[concept] = null
  return result as Record<string, number | null>
}

export async function assertPlanCapacity(tenantId: string, concept: PlanConcept, increment = 1) {
  if (IS_ONPREM_BUILD && getLicenseStatus().activated) return
  const snapshot = await getPlanUsage(tenantId)
  const item = snapshot.usage.find(value => value.concept === concept)!
  if (item.limit !== null && item.used + increment > item.limit) {
    throw createError({ statusCode: 402, statusMessage: `Se alcanzó el límite de ${item.label} del plan ${snapshot.plan}. Mejora tu plan para continuar.`, data: { code: 'plan_limit', concept, used: item.used, limit: item.limit, plan: snapshot.code } })
  }
}

export async function assertStampCapacity(tenantId: string) {
  if (IS_ONPREM_BUILD && getLicenseStatus().activated) return
  const plan = await getTenantSubscription(tenantId)
  const limit = licensedOnPremLimits(plan?.plan.limits).stamps
  if (limit === null || limit === undefined) return
  const [usage, balance] = await Promise.all([
    getPlanUsage(tenantId),
    withTenant(tenantId, tx => tx.execute(sql`SELECT COALESCE(SUM(remaining),0) AS balance FROM stamp_packages WHERE tenant_id = ${tenantId}::uuid`))
  ])
  const used = usage.usage.find(item => item.concept === 'stamps')!.used
  const available = Number((balance as unknown as Array<{ balance: string | number }>)[0]?.balance ?? 0)
  if (used >= limit && available < 1) throw createError({ statusCode: 402, statusMessage: `Se agotaron los timbres incluidos del plan ${plan!.plan.name} y no hay paquetes disponibles. Mejora tu plan o compra un paquete.`, data: { code: 'plan_limit', concept: 'stamps', used, limit, plan: plan!.plan.code } })
}

export async function consumeStampPackage(tenantId: string) {
  if (IS_ONPREM_BUILD && getLicenseStatus().activated) return false
  const plan = await getTenantSubscription(tenantId)
  const limit = licensedOnPremLimits(plan?.plan.limits).stamps
  if (limit === null || limit === undefined) return false
  const usage = await getPlanUsage(tenantId)
  if (usage.usage.find(item => item.concept === 'stamps')!.used <= limit) return false
  const rows = await withTenant(tenantId, tx => tx.execute(sql`
    UPDATE stamp_packages SET remaining = remaining - 1
    WHERE id = (SELECT id FROM stamp_packages WHERE tenant_id = ${tenantId}::uuid AND remaining > 0 ORDER BY purchased_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id
  `))
  return (rows as unknown[]).length > 0
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

/**
 * Campos consumidos de Stripe.Subscription. La versión actual entrega el
 * periodo en SubscriptionItem; los payloads anteriores pueden traerlo en la
 * raíz. Los tipos de los valores se toman del SDK instalado.
 */
export interface StripeSubscriptionSync {
  id: string
  status: Stripe.Subscription['status']
  metadata: Stripe.Subscription['metadata']
  customer: Stripe.Subscription['customer']
  trial_end: Stripe.Subscription['trial_end']
  cancel_at_period_end: Stripe.Subscription['cancel_at_period_end']
  items: {
    data: Array<{
      price: { id: Stripe.Price['id']; recurring?: { interval?: Stripe.Price.Recurring['interval'] } | null }
      current_period_start?: Stripe.SubscriptionItem['current_period_start'] | null
      current_period_end?: Stripe.SubscriptionItem['current_period_end'] | null
    }>
  }
  current_period_start?: number | null
  current_period_end?: number | null
}

async function findPlanFromStripePrice(priceId: string | null | undefined) {
  if (!priceId) return null
  const plans = (await listPlans()).filter(plan => plan.isActive)
  return plans.find(plan => planPriceId(plan, 'month') === priceId || planPriceId(plan, 'year') === priceId) ?? null
}

export async function syncStripeSubscription(subscription: StripeSubscriptionSync, tenantId?: string | null) {
  const resolvedTenantId = tenantId ?? subscription.metadata.tenantId
  if (!resolvedTenantId) throw new Error('Stripe no entregó el tenant de la suscripción')
  const priceId = subscription.items.data[0]?.price.id ?? null
  const plan = await findPlanFromStripePrice(priceId)
  if (!plan) throw new Error('El Price ID de Stripe no está vinculado a ningún plan de Flow')
  const interval = subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'year' : 'month'
  // Conservar la prioridad del campo raíz para payloads anteriores; el SDK
  // actual expone las fechas en el item.
  const periodStart = subscription.current_period_start ?? subscription.items.data[0]?.current_period_start ?? null
  const periodEnd = subscription.current_period_end ?? subscription.items.data[0]?.current_period_end ?? null
  const effectiveLimits = await getEffectivePlanLimits(resolvedTenantId, plan.id)
  await withTenant(resolvedTenantId, async tx => {
    await tx.execute(sql`SELECT set_config('app.plan_change_source', 'stripe_webhook', true)`)
    await tx.insert(tenantSubscriptions).values({
      tenantId: resolvedTenantId,
      planId: plan.id,
      provider: 'stripe',
      status: subscription.status,
      billingInterval: interval,
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: stripeDate(periodStart),
      currentPeriodEnd: stripeDate(periodEnd),
      trialEndsAt: stripeDate(subscription.trial_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date()
    }).onConflictDoUpdate({
      target: tenantSubscriptions.tenantId,
      set: {
        planId: plan.id, provider: 'stripe', status: subscription.status, billingInterval: interval,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id, stripePriceId: priceId,
        currentPeriodStart: stripeDate(periodStart), currentPeriodEnd: stripeDate(periodEnd),
        trialEndsAt: stripeDate(subscription.trial_end), cancelAtPeriodEnd: subscription.cancel_at_period_end, updatedAt: new Date()
      }
    })
    await tx.execute(sql`UPDATE tenants SET storage_limit_bytes = ${effectiveStorageLimit(effectiveLimits.storageBytes)}::bigint WHERE id = ${resolvedTenantId}::uuid`)
  })
  return getTenantSubscription(resolvedTenantId)
}

type StripeInvoiceSync = Pick<Stripe.Invoice, 'id' | 'metadata' | 'parent' | 'status' | 'currency' | 'subtotal' | 'total' | 'amount_paid' | 'period_start' | 'period_end' | 'created' | 'due_date' | 'status_transitions' | 'hosted_invoice_url' | 'invoice_pdf' | 'number' | 'customer'>

export async function syncStripeInvoice(invoice: StripeInvoiceSync, tenantId?: string | null) {
  const resolvedTenantId = tenantId ?? invoice.metadata?.tenantId ?? invoice.parent?.subscription_details?.metadata?.tenantId ?? null
  if (!resolvedTenantId) throw new Error('No se pudo asociar la factura de Stripe con un tenant')
  const subscription = await getTenantSubscription(resolvedTenantId)
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
  const plan = (await getAvailablePlansForTenant(tenantId)).find(row => row.code === planCode)
  if (!plan) {
    if (planCode === 'agenda') throw new PlanChangeNotAllowedError('El plan Agenda solo está disponible para organizaciones que ya lo tienen.')
    throw new PlanNotAvailableError('El plan seleccionado no está disponible')
  }
  if (plan.blockedBy.length) {
    const detail = plan.blockedBy.map(item => `${item.label} (${formatUsageValue(item, item.used)} de ${formatUsageValue(item, item.limit)})`).join(', ')
    throw new PlanChangeNotAllowedError(`Tu consumo actual supera el plan ${plan.name} en: ${detail}. Contacta a soporte.`)
  }
  const stripe = getStripeClient()
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
