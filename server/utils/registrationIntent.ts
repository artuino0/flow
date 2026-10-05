import { and, eq, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { plans, tenants, tenantSubscriptions } from '~/server/db/schema'
import { normalizeRegistrationChoice, type RegistrationChoice, type RegistrationIntent } from '~/utils/registrationIntent'

export function registrationEvent(event: 'registration_started' | 'plan_preselected' | 'checkout_started', choice: RegistrationChoice | null) {
  console.info(JSON.stringify({ event, plan: choice?.plan ?? null, interval: choice?.interval ?? null, source: choice?.utm_source ?? null }))
}

export async function validateRegistrationChoice(input: unknown): Promise<RegistrationChoice | null> {
  const choice = normalizeRegistrationChoice(input)
  if (!choice) return null
  const [plan] = await db.select({ key: plans.code }).from(plans).where(and(eq(plans.code, choice.plan), eq(plans.isPublic, true), eq(plans.isActive, true))).limit(1)
  return plan ? choice : null
}

export async function publicRegistrationPlans() {
  return db.select({ key: plans.code, name: plans.name, description: plans.description, monthlyPriceCents: plans.monthlyPriceCents, annualPriceCents: plans.annualPriceCents, currency: sql<string>`'MXN'` })
    .from(plans).where(and(eq(plans.isPublic, true), eq(plans.isActive, true))).orderBy(plans.sortOrder)
}

export async function saveRegistrationChoice(tenantId: string, input: unknown) {
  const choice = await validateRegistrationChoice(input)
  if (!choice) return null
  const intent: RegistrationIntent = { ...choice, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }
  const saved = await withTenant(tenantId, async tx => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update')
    if (!tenant) return false
    const [subscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1)
    // El Starter manual creado por getTenantSubscription durante onboarding no es una contratación.
    const fallback = subscription?.provider === 'manual' && subscription.status === 'trialing' && !subscription.stripeSubscriptionId && !subscription.trialEndsAt && !subscription.currentPeriodEnd && !tenant.trialConsumedAt
    if (subscription && ['active', 'trialing'].includes(subscription.status) && !fallback) return false
    await tx.update(tenants).set({ registrationIntent: intent }).where(eq(tenants.id, tenantId))
    return true
  })
  return saved ? intent : null
}

export async function clearRegistrationChoice(tenantId: string) {
  await withTenant(tenantId, tx => tx.update(tenants).set({ registrationIntent: null }).where(eq(tenants.id, tenantId)))
}

export async function getRegistrationChoice(tenantId: string) {
  const [row] = await withTenant(tenantId, tx => tx.select({ intent: tenants.registrationIntent, trialConsumedAt: tenants.trialConsumedAt }).from(tenants).where(eq(tenants.id, tenantId)))
  if (!row?.intent) return { intent: null, unavailable: false }
  const [subscription] = await withTenant(tenantId, tx => tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1))
  const fallback = subscription?.provider === 'manual' && subscription.status === 'trialing' && !subscription.stripeSubscriptionId && !subscription.trialEndsAt && !subscription.currentPeriodEnd && !row.trialConsumedAt
  const contracted = subscription && ['active', 'trialing'].includes(subscription.status) && !fallback
  if (contracted || !Number.isFinite(Date.parse(row.intent.expiresAt)) || Date.parse(row.intent.expiresAt) <= Date.now()) {
    await clearRegistrationChoice(tenantId)
    return { intent: null, unavailable: false }
  }
  const choice = await validateRegistrationChoice(row.intent)
  if (!choice) {
    await clearRegistrationChoice(tenantId)
    return { intent: null, unavailable: true }
  }
  return { intent: { plan: choice.plan, interval: choice.interval }, unavailable: false }
}
