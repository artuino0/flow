import { and, count, eq, isNull } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, subscriptionPlans, tenantSubscriptions } from '~/server/db/schema'
import { getEffectivePlanLimits, getPlanByKey } from '~/server/utils/plans'
import { getLicenseStatus, IS_ONPREM_BUILD } from '~/server/utils/license'

/** Consulta de cuota sin crear una suscripción durante POST /validate. */
export async function blueprintPlanImpact(tenantId: string, added: number) {
  const data = await withTenant(tenantId, async tx => {
    const [subscription] = await tx.select({ plan: subscriptionPlans }).from(tenantSubscriptions).innerJoin(subscriptionPlans, eq(subscriptionPlans.id, tenantSubscriptions.planId)).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1)
    const [{ value: used }] = await tx.select({ value: count() }).from(entities).where(and(eq(entities.tenantId, tenantId), isNull(entities.deletedAt), eq(entities.moduleKind, 'hecho')))
    return { plan: subscription?.plan, used }
  })
  const plan = data.plan ?? await getPlanByKey('starter')
  if (!plan) throw new Error('Falta el plan Starter en la base de datos')
  const limits = await getEffectivePlanLimits(tenantId, plan.id)
  const limit = IS_ONPREM_BUILD && getLicenseStatus().activated ? null : limits.modules
  return { code: plan.code, name: plan.name, used: data.used, added, after: data.used + added, limit, allowed: limit === null || data.used + added <= limit }
}
