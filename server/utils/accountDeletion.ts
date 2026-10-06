import { sql } from 'drizzle-orm'
import { db, withTenantRecovery } from '~/server/db'
import { accountBlocked, type AccountLifecycle } from '~/utils/accountLifecycle'
import { accountLifecycle } from './accountLifecycle'
import { lifecycleNoticeKinds } from './accountNotices'
import { deleteAccountObject, listAccountObjects } from './accountStorage'
import { getStripeClient } from './billing'
import { getSiteDomainProvider, type SiteDomainProviderName } from './siteDomains'
import { logger } from './logger'
import { accountObjectKey, ownAccountObject } from './accountObjectKey'

type Item = { kind: string; ref: string; payload: Record<string, unknown> }
let removalAdapter: ((item: Item) => Promise<void>) | null = null
export function setAccountRemovalAdapter(adapter: typeof removalAdapter) { removalAdapter = adapter }
async function remove(item: Item) {
  if (removalAdapter) return removalAdapter(item)
  if (item.kind === 'file') return deleteAccountObject(item.ref)
  if (item.kind === 'domain') {
    const provider = getSiteDomainProvider(String(item.payload.provider) as SiteDomainProviderName)
    if (!provider.configured) throw new Error('Proveedor de dominio sin configurar')
    return provider.remove(item.ref, item.payload.providerData as Record<string, unknown>)
  }
  const stripe = getStripeClient()
  try {
    if (item.kind === 'subscription') await stripe.subscriptions.cancel(item.ref)
    else if (item.kind === 'customer') await stripe.customers.del(item.ref)
    else throw new Error('Elemento de borrado inválido')
  } catch (error: any) { if (error?.statusCode !== 404) throw error }
}
export async function accountDeletionEligibility(tenantId: string, now = new Date()) {
  return withTenantRecovery(tenantId, tx => deletionEligibility(tx, tenantId, now))
}
async function deletionEligibility(tx: typeof db, tenantId: string, now: Date) {
  const [row] = await tx.execute(sql`select account_lifecycle_state(${tenantId}::uuid,${now.toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) as account`)
  const account = row!.account as AccountLifecycle
  if (account.reason === 'deletion_started') return { eligible: true, reason: 'started', account }
  if (account.exempt || !accountBlocked(account)) return { eligible: false, reason: 'active_or_exempt', account }
  if (!account.deleteAt || Date.parse(account.deleteAt) > now.getTime()) return { eligible: false, reason: 'retention_pending', account }
  const recipients = await tx.execute(sql`select distinct person_id from users u join roles r on r.id=u.role_id where u.tenant_id=${tenantId}::uuid and u.is_active and r.is_system`)
  if (!recipients.length) return { eligible: false, reason: 'no_administrator', account }
  const notices = await tx.execute(sql`select kind,recipient_id,sent_at from account_notices where tenant_id=${tenantId}::uuid and cycle=${account.suspendAt ?? ''}`)
  for (const kind of lifecycleNoticeKinds(account, now)) for (const recipient of recipients) {
    const sent = notices.find(notice => notice.kind === kind && notice.recipient_id === recipient.person_id)?.sent_at
    if (!sent) return { eligible: false, reason: 'mandatory_notice_pending', account }
    // Cada destinatario dispone del plazo mínimo de aviso después del ACK,
    // incluso si SMTP vuelve cuando la fecha original ya quedó atrás.
    const days = kind.startsWith('deletion_') ? Number(kind.slice(9)) : 0
    if (days > 0 && new Date(sent as string).getTime() + days * 86400000 > now.getTime()) return { eligible: false, reason: 'notice_period_pending', account }
  }
  return { eligible: true, reason: 'ready', account }
}
export async function reportAccountHold(tenantId: string, reason: string, now: Date) {
  await withTenantRecovery(tenantId, async tx => {
    const [tenant] = await tx.execute(sql`select account_lifecycle from tenants where id=${tenantId}::uuid for update`)
    if (!tenant) return
    const previous = (tenant.account_lifecycle ?? {}) as Record<string, unknown>
    await tx.execute(sql`update tenants set account_lifecycle=account_lifecycle || ${JSON.stringify({ deletionHoldReason: reason, deletionRetryAt: new Date(now.getTime() + 86400000).toISOString() })}::jsonb where id=${tenantId}::uuid`)
    if (previous.deletionHoldReason === reason) return
    logger.warn('account_deletion_postponed', { reason })
    const [platform] = await tx.execute(sql`select id from tenants where slug=${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}`)
    if (platform) {
      for (const email of (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
        const payload = { to: email, subject: 'Revisión de conservación de cuentas de Flow', text: 'Hay una cuenta cuyo borrado se pospuso. Revisa /platform/accounts: avisos pendientes, ausencia de administrador o fallo de limpieza.', html: '<p>Hay una cuenta cuyo borrado se pospuso. Revisa el panel de cuentas de Flow.</p>' }
        // El tenant de destino es el de plataforma, exento del mecanismo.
        await tx.execute(sql`select set_config('app.tenant_id',${String(platform.id)},true)`)
        await tx.execute(sql`insert into job_queue(tenant_id,kind,payload,idempotency_key) values (${String(platform.id)}::uuid,'email',${JSON.stringify(payload)}::jsonb,${`account-hold:${tenantId}:${reason}:${email}`}) on conflict do nothing`)
        await tx.execute(sql`select set_config('app.tenant_id',${tenantId},true)`)
      }
    }
  })
}
/** Candado de réplica por organización en una sola conexión. El pago usa
 * el candado de fila del mismo tenant; preparar el manifiesto no borra nada.
 * El primer cambio irreversible es confirmar deletionStarted. */
export async function deleteAccount(tenantId: string, options: { now?: Date; budgetMs?: number } = {}) {
  if (process.env.ACCOUNT_DELETION_ENABLED !== 'true') return { status: 'disabled' }
  const now = options.now ?? new Date(), started = Date.now(), budget = options.budgetMs ?? 5000
  const result = await withTenantRecovery(tenantId, async tx => {
    await tx.execute(sql`set local statement_timeout='10000'`)
    const [lock] = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${tenantId},191)) as acquired`)
    if (!lock?.acquired) return { status: 'busy' }
    const [tenant] = await tx.execute(sql`select id,account_lifecycle from tenants where id=${tenantId}::uuid for update`)
    if (!tenant) return { status: 'already_deleted' }
    const first = await deletionEligibility(tx, tenantId, now)
    if (!first.eligible) return { status: 'postponed', reason: first.reason }
    if (first.reason !== 'started') {
      const keys = (await Promise.all([`tenants/${tenantId}/`, `${tenantId}/`, `chat/${tenantId}/`].map(listAccountObjects))).flat()
      const tables = await tx.execute(sql`select c.relname,a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and not a.attisdropped where n.nspname='public' and c.relkind='r' and a.attname like '%storage_key' and (c.relname='tenants' or exists(select 1 from pg_attribute b where b.attrelid=c.oid and b.attname='tenant_id' and not b.attisdropped))`)
      for (const table of tables) {
        const rows = await tx.execute(sql`select ${sql.identifier(String(table.attname))} as key from ${sql.identifier(String(table.relname))} where ${sql.identifier(table.relname === 'tenants' ? 'id' : 'tenant_id')}=${tenantId}::uuid`)
        for (const row of rows) if (typeof row.key === 'string') keys.push(accountObjectKey(tenantId, String(table.relname), row.key))
      }
      for (const key of new Set(keys)) {
        if (!ownAccountObject(tenantId, key)) throw new Error('Archivo fuera del prefijo de propiedad; limpieza asistida requerida')
        await tx.execute(sql`insert into account_deletion_items(tenant_id,kind,ref) values (${tenantId}::uuid,'file',${key}) on conflict do nothing`)
      }
      const domains = await tx.execute(sql`select hostname,provider,provider_data from site_domains where tenant_id=${tenantId}::uuid`)
      for (const domain of domains) await tx.execute(sql`insert into account_deletion_items(tenant_id,kind,ref,payload) values (${tenantId}::uuid,'domain',${String(domain.hostname)},${JSON.stringify({ provider: domain.provider, providerData: domain.provider_data })}::jsonb) on conflict do nothing`)
      const subscriptions = await tx.execute(sql`select stripe_subscription_id,stripe_customer_id from tenant_subscriptions where tenant_id=${tenantId}::uuid`)
      for (const row of subscriptions) for (const [kind, ref] of [['subscription', row.stripe_subscription_id], ['customer', row.stripe_customer_id]]) if (ref) await tx.execute(sql`insert into account_deletion_items(tenant_id,kind,ref) values (${tenantId}::uuid,${String(kind)},${String(ref)}) on conflict do nothing`)
      const second = await deletionEligibility(tx, tenantId, new Date(Math.max(now.getTime(), Date.now())))
      if (!second.eligible) return { status: 'postponed', reason: second.reason }
      await tx.execute(sql`update tenants set account_lifecycle=account_lifecycle || ${JSON.stringify({ deletionStarted: true, deletionStartedAt: now.toISOString(), suspendedAt: first.account.suspendAt, deletionScheduledAt: first.account.deleteAt, deletionHoldReason: null })}::jsonb where id=${tenantId}::uuid`)
      // Nada externo se elimina antes de confirmar esta etapa.
      return { status: 'prepared' }
    }
    const items = await tx.execute(sql`select id,kind,ref,payload from account_deletion_items where tenant_id=${tenantId}::uuid and done_at is null order by case kind when 'file' then 0 when 'domain' then 1 when 'subscription' then 2 else 3 end,id limit 25`)
    for (const item of items) {
      if (Date.now() - started >= budget) return { status: 'continuing' }
      await remove({ kind: String(item.kind), ref: String(item.ref), payload: item.payload as Record<string, unknown> })
      await tx.execute(sql`update account_deletion_items set done_at=${now.toISOString()}::timestamptz where id=${String(item.id)}::uuid`)
    }
    const [remaining] = await tx.execute(sql`select count(*)::int as count from account_deletion_items where tenant_id=${tenantId}::uuid and done_at is null`)
    if (Number(remaining!.count) > 0) return { status: 'continuing' }
    const [batch] = await tx.execute(sql`select account_delete_batch(${tenantId}::uuid,500) as count`)
    if (Number(batch!.count) > 0) return { status: 'continuing' }
    await tx.execute(sql`select account_delete_finish(${tenantId}::uuid)`)
    return { status: 'deleted' }
  }).catch(async () => { await reportAccountHold(tenantId, 'cleanup_failed', now); return { status: 'postponed', reason: 'cleanup_failed' } })
  if ('reason' in result && result.reason && !['active_or_exempt', 'retention_pending'].includes(result.reason)) await reportAccountHold(tenantId, result.reason, now)
  return result
}
export async function runAccountDeletionTick(budgetMs = 5000, now = new Date()) {
  if (process.env.ACCOUNT_DELETION_ENABLED !== 'true') return { disabled: true }
  const started = Date.now()
  const rows = await db.execute(sql`select id from tenants where account_lifecycle->>'deletionStarted'='true' or (
    (account_lifecycle_state(id,${now.toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''})->>'deleteAt')::timestamptz<=${now.toISOString()}::timestamptz
    and coalesce((account_lifecycle->>'deletionRetryAt')::timestamptz,'1970-01-01'::timestamptz)<=${now.toISOString()}::timestamptz
  ) order by coalesce(account_lifecycle->>'deletionRetryAt',''),id limit 25`)
  for (const row of rows) {
    if (Date.now() - started >= budgetMs) break
    if (!accountBlocked(await accountLifecycle(String(row.id), now))) continue
    await deleteAccount(String(row.id), { now, budgetMs: Math.max(500, budgetMs - (Date.now() - started)) })
  }
  return { disabled: false }
}
