import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db, withTenantRecovery } from '~/server/db'
import { accountLifecycle } from './accountLifecycle'
import { withAccountRecovery } from './accountContext'
import { sendPlainEmail } from './mailer'
import { logger } from './logger'
import type { ClaimedJob, JobOutcome } from './jobQueue'
import type { AccountLifecycle } from '~/utils/accountLifecycle'
import { getPublicAppBaseUrl } from './publicUrls'

const time = (value: string | null | undefined) => value ? Date.parse(value) : 0
function noticeText(kind: string, state: AccountLifecycle) {
  const suspend = state.suspendAt ? new Date(state.suspendAt).toISOString().slice(0, 10) : ''
  const deletion = state.deleteAt ? new Date(state.deleteAt).toISOString().slice(0, 10) : ''
  if (kind === 'payment_due') return 'No se pudo completar el cobro. Tu organización sigue funcionando durante el periodo de gracia. Revisa tu método de pago.'
  if (kind === 'suspension_warning') return `Tu cuenta se suspenderá el ${suspend} (UTC) si el pago sigue pendiente.`
  if (kind === 'suspended') return `Tu cuenta está suspendida. Sus datos se conservan. La fecha prevista de borrado es ${deletion} (UTC). Pagar antes de que empiece el borrado restaura el acceso.`
  return `El plazo para conservar tus datos está por terminar. El borrado definitivo está previsto a partir del ${deletion} (UTC). Paga para reactivar o exporta tus datos antes de esa fecha.`
}
export function lifecycleNoticeKinds(state: AccountLifecycle, now: Date) {
  const kinds: string[] = []
  if (state.phase === 'payment_due') kinds.push('payment_due', 'suspension_warning')
  if (['suspended', 'pending_deletion'].includes(state.phase)) {
    if (state.paymentDueAt) kinds.push('payment_due', 'suspension_warning')
    kinds.push('suspended')
    for (const days of state.policy?.warningDays ?? []) if (now.getTime() >= time(state.deleteAt) - days * 86400000) kinds.push(`deletion_${days}`)
  }
  return kinds
}
export async function reconcileAccount(tenantId: string, now = new Date()) {
  return withTenantRecovery(tenantId, async tx => {
    await tx.execute(sql`select id from tenants where id=${tenantId}::uuid for update`)
    const [current] = await tx.execute(sql`select account_lifecycle_state(${tenantId}::uuid,${now.toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) as account`)
    const state = current!.account as AccountLifecycle
    const [previous] = await tx.execute(sql`select account_lifecycle from tenants where id=${tenantId}::uuid`)
    if (!previous) return state
    const saved = (previous.account_lifecycle ?? {}) as Record<string, unknown>
    if (saved.phase !== state.phase) {
      const metadata = { phase: state.phase, ...(state.phase === 'active' ? { suspendedAt: null, deletionScheduledAt: null, reason: null } : { suspendedAt: state.suspendAt, deletionScheduledAt: state.deleteAt, reason: state.reason }) }
      await tx.execute(sql`update tenants set account_lifecycle=account_lifecycle || ${JSON.stringify(metadata)}::jsonb where id=${tenantId}::uuid`)
      const hash = createHash('sha256').update(tenantId).digest('hex')
      await tx.execute(sql`insert into account_lifecycle_events(tenant_hash,phase,reason,occurred_at) values (${hash},${state.phase},${state.reason ?? 'subscription'},${now.toISOString()}::timestamptz)`)
      logger.info('account_lifecycle', { phase: state.phase, reason: state.reason ?? 'subscription' })
      // Evento sin contenido del cliente para que el CRM refleje la etapa.
      await tx.execute(sql`select account_capture_crm_event(${tenantId}::uuid)`)
    }
    const recipients = await tx.execute(sql`select distinct p.id from users u join roles r on r.id=u.role_id join people p on p.id=u.person_id where u.tenant_id=${tenantId}::uuid and u.is_active and r.is_system`)
    const cycle = state.suspendAt ?? state.paymentDueAt
    if (!cycle) return state
    for (const kind of lifecycleNoticeKinds(state, now)) for (const recipient of recipients) {
      const inserted = await tx.execute(sql`insert into account_notices(tenant_id,cycle,kind,recipient_id) values (${tenantId}::uuid,${cycle},${kind},${String(recipient.id)}::uuid) on conflict do nothing returning id`)
      if (!inserted.length) continue
      const [job] = await tx.execute(sql`insert into job_queue(tenant_id,kind,payload,idempotency_key,max_attempts) values (${tenantId}::uuid,'account_notice',${JSON.stringify({ noticeId: inserted[0]!.id })}::jsonb,${'account-notice:' + String(inserted[0]!.id)},100000) returning id`)
      await tx.execute(sql`update account_notices set job_id=${String(job!.id)}::uuid where id=${String(inserted[0]!.id)}::uuid`)
    }
    return state
  })
}
export async function handleAccountNotice(job: ClaimedJob): Promise<JobOutcome> {
  const tenantId = job.tenantId
  if (!tenantId) return { ok: false, retryable: false, error: 'Trabajo sin organización inválido' }
  if (typeof job.payload.noticeId !== 'string') return { ok: false, retryable: false, error: 'Aviso inválido' }
  return withAccountRecovery(async () => {
    // Una conexión/candado por entrega. ACK y marca se confirman juntos; SMTP
    // no ofrece idempotencia externa si el proceso cae después del ACK.
    return withTenantRecovery(tenantId, async tx => {
      const [notice] = await tx.execute(sql`select n.*,p.email from account_notices n join people p on p.id=n.recipient_id where n.id=${String(job.payload.noticeId)}::uuid and n.tenant_id=${tenantId}::uuid for update of n`)
      if (!notice || notice.sent_at) return { ok: true }
      const rows = await tx.execute(sql`select account_lifecycle_state(${tenantId}::uuid,${new Date().toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) as account`)
      const state = rows[0]!.account as AccountLifecycle
      if (state.phase === 'active' || notice.cycle !== state.suspendAt) return { ok: true }
      const base = getPublicAppBaseUrl().replace(/\/$/, '')
      const text = noticeText(String(notice.kind), state) + `\nPagar o reactivar: ${base}/cuenta-suspendida\nExportar tus datos: ${base}/cuenta-suspendida\nSi necesitas ayuda, contacta al administrador de Flow.`
      try {
        await sendPlainEmail({ to: String(notice.email), subject: 'Información sobre tu cuenta de Flow', text, html: `<p>${noticeText(String(notice.kind), state)}</p><p><a href="${base}/cuenta-suspendida">Pagar, reactivar o exportar tus datos</a></p>` })
      } catch { return { ok: false, retryable: true, error: 'No se pudo enviar el aviso obligatorio de cuenta.' } }
      await tx.execute(sql`update account_notices set sent_at=${new Date().toISOString()}::timestamptz where id=${String(notice.id)}::uuid`)
      return { ok: true }
    })
  })
}
export async function reconcileAccounts(budgetMs = 5000, now = new Date()) {
  const started = Date.now(); let checked = 0, errors = 0
  const rows = await db.execute(sql`select id from tenants order by coalesce((account_lifecycle->>'checkedAt')::timestamptz,created_at),id limit 100`)
  for (const row of rows) {
    if (Date.now() - started >= budgetMs) break
    try {
      const account = await reconcileAccount(String(row.id), now)
      await (await import('./accountExport')).cleanupExpiredAccountExports(String(row.id), now)
      if (['suspended', 'pending_deletion'].includes(account.phase) && account.deleteAt && Date.parse(account.deleteAt) <= now.getTime()) {
        const { accountDeletionEligibility, reportAccountHold } = await import('./accountDeletion')
        const eligibility = await accountDeletionEligibility(String(row.id), now)
        if (!eligibility.eligible && ['no_administrator', 'mandatory_notice_pending'].includes(eligibility.reason)) await reportAccountHold(String(row.id), eligibility.reason, now)
      }
      await withTenantRecovery(String(row.id), tx => tx.execute(sql`update tenants set account_lifecycle=jsonb_set(account_lifecycle,'{checkedAt}',to_jsonb(${now.toISOString()}::text),true) where id=${String(row.id)}::uuid`))
      checked++
    } catch { errors++; logger.warn('account_lifecycle_reconcile_failed') }
  }
  return { checked, errors }
}
