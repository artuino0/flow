import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { aiCreditLedger, aiCreditPackages, moduleDesignSessions } from '~/server/db/schema'
import { getTenantSubscription } from '~/server/utils/billing'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { getDesignerTimeoutMs } from '~/server/utils/aiProvider'

type Allocation = { ledgerId: string; credits: number; packageId: string | null; periodStart: Date | null }

export async function aiCreditBalance(tenantId: string) {
  const subscription = await getTenantSubscription(tenantId)
  const included = subscription?.plan.limits.aiCredits === undefined ? 0 : subscription.plan.limits.aiCredits
  const [row] = await withTenant(tenantId, tx => tx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(CASE WHEN kind = 'refund' THEN -credits ELSE credits END)
        FROM ai_credit_ledger WHERE tenant_id = ${tenantId}::uuid AND package_id IS NULL
        AND period_start = (date_trunc('month', now() AT TIME ZONE tenants.timezone) AT TIME ZONE tenants.timezone)), 0) AS used,
      COALESCE((SELECT SUM(remaining) FROM ai_credit_packages WHERE tenant_id = ${tenantId}::uuid), 0) AS packages
    FROM tenants WHERE id = ${tenantId}::uuid
  `)) as unknown as Array<{ used: string; packages: string }>
  const used = Number(row?.used ?? 0)
  return { included, used, includedRemaining: included === null ? null : Math.max(0, included - used), packages: Number(row?.packages ?? 0) }
}

export async function reserveAiCredits(tenantId: string, sessionId: string, cost: number, kind: 'generate' | 'iterate'): Promise<Allocation[]> {
  const subscription = await getTenantSubscription(tenantId)
  const limit = subscription?.plan.limits.aiCredits === undefined ? 0 : subscription.plan.limits.aiCredits
  return withTenant(tenantId, async tx => {
    // El bloqueo del tenant serializa todas las reservas, incluso de sesiones distintas.
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`)
    const [session] = await tx.select().from(moduleDesignSessions).where(and(eq(moduleDesignSessions.id, sessionId), eq(moduleDesignSessions.tenantId, tenantId))).limit(1)
    if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
    if (session.status !== 'draft' && session.status !== 'error') throw createError({ statusCode: 409, statusMessage: 'La sesión ya está cerrada' })
    if (session.processingAt) throw createError({ statusCode: 409, statusMessage: 'La sesión ya está procesando un mensaje' })
    const [usage] = await tx.execute(sql`
      SELECT (date_trunc('month', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone) AS period_start,
        COALESCE((SELECT SUM(CASE WHEN l.kind = 'refund' THEN -l.credits ELSE l.credits END)
          FROM ai_credit_ledger l WHERE l.tenant_id = ${tenantId}::uuid AND l.package_id IS NULL
          AND l.period_start = (date_trunc('month', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone)), 0) AS used
      FROM tenants t WHERE t.id = ${tenantId}::uuid
    `) as unknown as Array<{ used: string; period_start: string | Date }>
    const included = limit === null ? cost : Math.min(cost, Math.max(0, limit - Number(usage?.used ?? 0)))
    let missing = cost - included
    const packages = missing ? await tx.select().from(aiCreditPackages).where(and(eq(aiCreditPackages.tenantId, tenantId), sql`${aiCreditPackages.remaining} > 0`)).orderBy(aiCreditPackages.purchasedAt, aiCreditPackages.id) : []
    if (packages.reduce((sum, row) => sum + row.remaining, 0) < missing) throw createError({ statusCode: 402, statusMessage: 'No tienes créditos de IA suficientes.', data: { code: 'ai_credits' } })
    const allocations: Allocation[] = []
    const insert = async (credits: number, packageId: string | null) => {
      const periodStart = packageId ? null : new Date(usage!.period_start)
      const [row] = await tx.insert(aiCreditLedger).values({ tenantId, sessionId, kind, credits, packageId, periodStart, settledAt: null }).returning({ id: aiCreditLedger.id })
      allocations.push({ ledgerId: row!.id, credits, packageId, periodStart })
    }
    if (included) await insert(included, null)
    for (const row of packages) {
      if (!missing) break
      const credits = Math.min(missing, row.remaining)
      await tx.update(aiCreditPackages).set({ remaining: row.remaining - credits }).where(eq(aiCreditPackages.id, row.id))
      await insert(credits, row.id)
      missing -= credits
    }
    await tx.update(moduleDesignSessions).set({ processingAt: new Date(), updatedAt: new Date() }).where(eq(moduleDesignSessions.id, sessionId))
    return allocations
  })
}

/** Reembolsa reservas IA cuya petición murió sin ejecutar su finalizador. */
export async function recoverOrphanedAiReservations(tenantId: string, sessionId?: string) {
  const cutoff = new Date(Date.now() - getDesignerTimeoutMs() * 2)
  return withTenant(tenantId, async tx => {
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`)
    const filters = [
      eq(moduleDesignSessions.tenantId, tenantId),
      lt(moduleDesignSessions.processingAt, cutoff),
      ...(sessionId ? [eq(moduleDesignSessions.id, sessionId)] : []),
      sql`EXISTS (
        SELECT 1 FROM ai_credit_ledger l
        WHERE l.tenant_id = ${tenantId}::uuid AND l.session_id = ${moduleDesignSessions.id}
          AND l.kind IN ('generate', 'iterate') AND l.settled_at IS NULL
      )`
    ]
    const stale = await tx.select({ id: moduleDesignSessions.id }).from(moduleDesignSessions).where(and(...filters)).for('update')
    let recovered = 0
    for (const { id } of stale) {
      const pending = await tx.select().from(aiCreditLedger).where(and(
        eq(aiCreditLedger.tenantId, tenantId), eq(aiCreditLedger.sessionId, id),
        inArray(aiCreditLedger.kind, ['generate', 'iterate']), isNull(aiCreditLedger.settledAt)
      )).for('update')
      if (!pending.length) continue
      const settledAt = new Date()
      for (const reservation of pending) {
        await tx.update(aiCreditLedger).set({ settledAt }).where(eq(aiCreditLedger.id, reservation.id))
        if (reservation.packageId) await tx.execute(sql`UPDATE ai_credit_packages SET remaining = remaining + ${reservation.credits} WHERE id = ${reservation.packageId}::uuid`)
        await tx.insert(aiCreditLedger).values({
          tenantId, sessionId: id, kind: 'refund', credits: reservation.credits,
          packageId: reservation.packageId, periodStart: reservation.periodStart, settledAt
        })
      }
      await tx.update(moduleDesignSessions).set({ status: 'error', processingAt: null, updatedAt: settledAt })
        .where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId), lt(moduleDesignSessions.processingAt, cutoff)))
      recovered++
    }
    return recovered
  })
}

export async function finishAiCredits(tenantId: string, sessionId: string, allocations: Allocation[], usage: { inputTokens: number; outputTokens: number; model: string }, success: boolean, result?: { blueprint: Blueprint; messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>; version: number }) {
  return withTenant(tenantId, async tx => {
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`)
    const pending = await tx.select({ id: aiCreditLedger.id }).from(aiCreditLedger).where(and(
      eq(aiCreditLedger.tenantId, tenantId), eq(aiCreditLedger.sessionId, sessionId),
      inArray(aiCreditLedger.id, allocations.map(allocation => allocation.ledgerId)), isNull(aiCreditLedger.settledAt)
    )).for('update')
    // Una recuperación automática ya liquidó la operación; no vuelvas a guardar el resultado ni a reembolsar.
    if (pending.length !== allocations.length) return false
    const settledAt = new Date()
    for (const [index, allocation] of allocations.entries()) {
      // Una generación puede repartirse entre cuota y paquetes; sus tokens se registran una vez.
      await tx.update(aiCreditLedger).set({ inputTokens: index === 0 ? usage.inputTokens : 0, outputTokens: index === 0 ? usage.outputTokens : 0, model: usage.model || null, settledAt }).where(eq(aiCreditLedger.id, allocation.ledgerId))
      if (!success) {
        if (allocation.packageId) await tx.execute(sql`UPDATE ai_credit_packages SET remaining = remaining + ${allocation.credits} WHERE id = ${allocation.packageId}::uuid`)
        await tx.insert(aiCreditLedger).values({ tenantId, sessionId, kind: 'refund', credits: allocation.credits, packageId: allocation.packageId, periodStart: allocation.periodStart, settledAt, model: usage.model || null })
      }
    }
    await tx.update(moduleDesignSessions).set({ processingAt: null, status: success ? 'draft' : 'error', updatedAt: new Date(), ...(success ? { creditsConsumed: sql`${moduleDesignSessions.creditsConsumed} + ${allocations.reduce((sum, item) => sum + item.credits, 0)}`, ...(result ? { blueprint: result.blueprint, messages: result.messages, version: result.version } : {}) } : {}) }).where(eq(moduleDesignSessions.id, sessionId))
    return true
  })
}
