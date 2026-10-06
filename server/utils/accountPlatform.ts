import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { createError } from 'h3'
import { db, withTenantRecovery } from '~/server/db'
import { accountLifecycle } from './accountLifecycle'
import { reconcileAccount } from './accountNotices'
import { accountDeletionEligibility } from './accountDeletion'

export const accountPolicySchema = z.object({
  graceDays: z.number().int().min(0).max(90), retentionDays: z.number().int().min(31).max(3650),
  warningDays: z.array(z.number().int().min(1).max(365)).min(1).max(8)
}).strict().refine(value => new Set(value.warningDays).size === value.warningDays.length && Math.max(...value.warningDays) < value.retentionDays, 'Los avisos deben ser únicos y anteriores al plazo de retención.')
export const accountActionSchema = z.object({
  tenantId: z.string().uuid(), action: z.enum(['policy', 'exempt', 'suspend', 'reactivate', 'extend', 'cancel_deletion']),
  reason: z.string().trim().min(3).max(500), policy: accountPolicySchema.optional(),
  exempt: z.boolean().optional(), retentionUntil: z.string().datetime().optional()
}).strict()
export async function listAccountLifecycle() {
  const [settings] = await db.execute(sql`select policy from account_lifecycle_settings where id=true`)
  const rows = await db.execute(sql`select id,name,slug,account_lifecycle from tenants order by name,id`)
  const organizations = []
  for (const row of rows) organizations.push({ id: String(row.id), name: String(row.name), slug: String(row.slug),
    account: await accountLifecycle(String(row.id)), exception: ((row.account_lifecycle ?? {}) as Record<string, unknown>).policy ?? null,
    holdReason: ((row.account_lifecycle ?? {}) as Record<string, unknown>).deletionHoldReason ?? null })
  return { policy: settings!.policy, organizations, deletionEnabled: process.env.ACCOUNT_DELETION_ENABLED === 'true' }
}
export async function changeAccountPolicy(value: unknown) {
  const policy = accountPolicySchema.parse(value)
  await db.execute(sql`update account_lifecycle_settings set policy=${JSON.stringify(policy)}::jsonb,updated_at=now() where id=true`)
  return { policy }
}
export async function changeAccountLifecycle(value: unknown, now = new Date()) {
  const input = accountActionSchema.parse(value)
  await withTenantRecovery(input.tenantId, async tx => {
    const [row] = await tx.execute(sql`select id,account_lifecycle from tenants where id=${input.tenantId}::uuid for update`)
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Organización no encontrada.' })
    const metadata = (row.account_lifecycle ?? {}) as Record<string, unknown>
    if (metadata.deletionStarted) throw createError({ statusCode: 409, statusMessage: 'El borrado irreversible ya comenzó. Contacta al equipo de Flow.' })
    const states = await tx.execute(sql`select account_lifecycle_state(${input.tenantId}::uuid,${now.toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) as account`)
    const account = states[0]!.account as { exempt?: boolean }
    if (account.exempt && input.action === 'suspend') throw createError({ statusCode: 409, statusMessage: 'Esta organización está exenta de suspensión.' })
    let patch: Record<string, unknown> = { exceptionReason: input.reason }
    if (input.action === 'policy') {
      if (!input.policy) throw createError({ statusCode: 422, statusMessage: 'Indica los plazos de la excepción.' })
      patch.policy = input.policy
    } else if (input.action === 'exempt') {
      if (input.exempt === undefined) throw createError({ statusCode: 422, statusMessage: 'Indica si la excepción está activa.' })
      patch.exempt = input.exempt
    } else if (input.action === 'suspend') patch.manualSuspendedAt = now.toISOString()
    else if (input.action === 'reactivate' || input.action === 'cancel_deletion') {
      // Una reactivación manual constituye una exención explícita: nunca
      // pretende que la plataforma haya cobrado o altere la suscripción.
      patch = { ...patch, exempt: true, manualSuspendedAt: null, retentionUntil: null }
    } else {
      if (!input.retentionUntil || Date.parse(input.retentionUntil) <= now.getTime()) throw createError({ statusCode: 422, statusMessage: 'Indica una fecha futura de conservación.' })
      patch.retentionUntil = input.retentionUntil
    }
    await tx.execute(sql`update tenants set account_lifecycle=account_lifecycle || ${JSON.stringify(patch)}::jsonb where id=${input.tenantId}::uuid`)
    await tx.execute(sql`insert into account_lifecycle_events(tenant_hash,phase,reason) values (${createHash('sha256').update(input.tenantId).digest('hex')},${input.action},'platform_override')`)
  })
  return { account: await reconcileAccount(input.tenantId, now) }
}
export async function simulateAccountLifecycle(now = new Date()) {
  const rows = await db.execute(sql`select id,name from tenants order by id`)
  const organizations = []
  for (const row of rows) {
    const account = await accountLifecycle(String(row.id), now)
    if (account.exempt) continue
    const eligibility = await accountDeletionEligibility(String(row.id), now)
    organizations.push({ id: String(row.id), name: String(row.name), account, wouldSuspend: ['suspended', 'pending_deletion'].includes(account.phase), wouldDelete: eligibility.eligible, deletionReason: eligibility.reason })
  }
  return { simulation: true, at: now.toISOString(), organizations }
}
