import { asc, eq, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { plans, planLimits, tenantLimitOverrides, tenantSubscriptions, tenants } from '~/server/db/schema'
import { createShortCache, ttlFromEnv } from '~/server/utils/shortCache'
import { getLicenseStatus, IS_ONPREM_BUILD } from '~/server/utils/license'
import { PLAN_CONCEPTS, type PlanConcept } from '~/utils/planConcepts'
export { PLAN_CONCEPTS }
export type { PlanConcept } from '~/utils/planConcepts'
export type PlanLimits = Record<PlanConcept, number | null>
export type PlanRow = typeof plans.$inferSelect

const cache = createShortCache<unknown>({ ttlMs: ttlFromEnv('PLAN_CACHE_TTL_MS', 5_000), maxEntries: 2_000 })
const zeroLimits = (): PlanLimits => Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, null])) as PlanLimits
export function effectiveStorageLimit(value: number | null | undefined) {
  return IS_ONPREM_BUILD && getLicenseStatus().activated ? Number.MAX_SAFE_INTEGER : value ?? Number.MAX_SAFE_INTEGER
}

export function invalidatePlanCache(tenantId?: string, planKey?: string) {
  if (tenantId) cache.deletePrefix(`tenant:${tenantId}:`)
  if (planKey) { cache.delete(`plan:${planKey}`); cache.delete('catalog'); cache.deletePrefix('tenant:') }
  if (!tenantId && !planKey) cache.clear()
}

export async function listPlans() {
  const cached = cache.get('catalog') as Array<PlanRow & { limits: PlanLimits }> | undefined
  if (cached) return cached
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder))
  const result = await Promise.all(rows.map(async plan => ({ ...plan, limits: await getPlanLimits(plan.id) })))
  cache.set('catalog', result)
  return result
}

export async function getPlanByKey(key: string) {
  const cached = cache.get(`plan:${key}`) as (PlanRow & { limits: PlanLimits }) | undefined
  if (cached) return cached
  const [plan] = await db.select().from(plans).where(eq(plans.code, key)).limit(1)
  if (!plan) return null
  const result = { ...plan, limits: await getPlanLimits(plan.id) }
  cache.set(`plan:${key}`, result)
  return result
}

async function getPlanLimits(planId: string): Promise<PlanLimits> {
  const result = zeroLimits()
  const rows = await db.select({ concept: planLimits.concept, value: planLimits.value }).from(planLimits).where(eq(planLimits.planId, planId))
  for (const row of rows) if (PLAN_CONCEPTS.includes(row.concept as PlanConcept)) result[row.concept as PlanConcept] = row.value
  return result
}

export async function getEffectivePlanLimits(tenantId: string, planId: string): Promise<PlanLimits> {
  const key = `tenant:${tenantId}:plan:${planId}`
  const cached = cache.get(key) as PlanLimits | undefined
  if (cached) return cached
  const rows = await withTenant(tenantId, tx => tx.execute(sql`
    SELECT pl.concept,
      CASE WHEN o.id IS NOT NULL THEN o.value ELSE pl.value END AS value
    FROM plan_limits pl
    LEFT JOIN tenant_limit_overrides o
      ON o.tenant_id = ${tenantId}::uuid AND o.concept = pl.concept
      AND (o.valid_from IS NULL OR o.valid_from <= now())
      AND (o.valid_until IS NULL OR o.valid_until > now())
    WHERE pl.plan_id = ${planId}::uuid
    UNION ALL
    SELECT o.concept, o.value FROM tenant_limit_overrides o
    WHERE o.tenant_id = ${tenantId}::uuid
      AND (o.valid_from IS NULL OR o.valid_from <= now())
      AND (o.valid_until IS NULL OR o.valid_until > now())
      AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = ${planId}::uuid AND pl.concept = o.concept)
  `)) as unknown as Array<{ concept: string; value: number | string | null }>
  const result = zeroLimits()
  for (const row of rows) if (PLAN_CONCEPTS.includes(row.concept as PlanConcept)) result[row.concept as PlanConcept] = row.value === null ? null : Number(row.value)
  cache.set(key, result)
  return result
}

export async function savePlan(input: { code: string; name: string; isActive: boolean; isPublic: boolean; sortOrder: number; monthlyPriceCents: number; annualPriceCents: number; stripeMonthlyPriceId: string | null; stripeAnnualPriceId: string | null; limits: Partial<PlanLimits> }, existingKey?: string) {
  const values = Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, input.limits[concept] ?? null])) as PlanLimits
  await db.transaction(async tx => {
    let planId: string
    if (existingKey) {
      const [updated] = await tx.update(plans).set({ code: input.code, name: input.name, isActive: input.isActive, isPublic: input.isPublic, sortOrder: input.sortOrder, monthlyPriceCents: input.monthlyPriceCents, annualPriceCents: input.annualPriceCents, stripeMonthlyPriceId: input.stripeMonthlyPriceId, stripeAnnualPriceId: input.stripeAnnualPriceId, updatedAt: new Date() }).where(eq(plans.code, existingKey)).returning({ id: plans.id })
      if (!updated) throw createError({ statusCode: 404, statusMessage: 'Plan no encontrado' })
      planId = updated.id
      await tx.delete(planLimits).where(eq(planLimits.planId, planId))
    } else {
      const [created] = await tx.insert(plans).values({ code: input.code, name: input.name, isActive: input.isActive, isPublic: input.isPublic, sortOrder: input.sortOrder, monthlyPriceCents: input.monthlyPriceCents, annualPriceCents: input.annualPriceCents, stripeMonthlyPriceId: input.stripeMonthlyPriceId, stripeAnnualPriceId: input.stripeAnnualPriceId }).returning({ id: plans.id })
      planId = created!.id
    }
    await tx.insert(planLimits).values(PLAN_CONCEPTS.map(concept => ({ planId, concept, value: values[concept] })))
  })
  invalidatePlanCache(undefined, input.code)
  if (existingKey && existingKey !== input.code) invalidatePlanCache(undefined, existingKey)
  const [saved] = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, input.code)).limit(1)
  if (saved && existingKey) await syncPlanStorageLimits(saved.id)
}

export async function saveTenantOverride(input: { tenantId: string; concept: PlanConcept; value: number | null; reason: string; validFrom: Date | null; validUntil: Date | null }) {
  await withTenant(input.tenantId, async tx => {
    await tx.insert(tenantLimitOverrides).values({ ...input })
      .onConflictDoUpdate({ target: [tenantLimitOverrides.tenantId, tenantLimitOverrides.concept], set: { value: input.value, reason: input.reason, validFrom: input.validFrom, validUntil: input.validUntil, updatedAt: new Date() } })
  })
  invalidatePlanCache(input.tenantId)
  await syncTenantStorageLimit(input.tenantId)
}

export async function syncTenantStorageLimit(tenantId: string) {
  const subscription = await withTenant(tenantId, tx => tx.select({ planId: tenantSubscriptions.planId }).from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1))
  if (!subscription[0]) return
  const effective = await getEffectivePlanLimits(tenantId, subscription[0].planId)
  await withTenant(tenantId, tx => tx.execute(sql`UPDATE tenants SET storage_limit_bytes = ${effectiveStorageLimit(effective.storageBytes)}::bigint WHERE id = ${tenantId}::uuid`))
}

async function syncPlanStorageLimits(planId: string) {
  const organizations = await db.select({ id: tenants.id }).from(tenants)
  for (const organization of organizations) {
    const subscription = await withTenant(organization.id, tx => tx.select({ planId: tenantSubscriptions.planId }).from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, organization.id)).limit(1))
    if (subscription[0]?.planId === planId) await syncTenantStorageLimit(organization.id)
  }
}
