import { sql, eq } from 'drizzle-orm'
import { withTenant, type db } from '~/server/db'
import { tenantSubscriptions } from '~/server/db/schema'
import { getEffectivePlanLimits, getPlanByKey } from '~/server/utils/plans'
import { withRecordActor } from '~/server/utils/recordActorContext'
import type { AuthTokenPayload } from '~/server/utils/auth'
import type { AgentReply } from '~/utils/agentConversation'
type Tx = typeof db
export async function readAgentPlan(tenantId: string) {
 const [subscription] = await withTenant(tenantId, tx => tx.select({ planId: tenantSubscriptions.planId }).from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId,tenantId)).limit(1))
 // La vista de plataforma no crea suscripciones ni escribe otras tablas.
 const rows = await withTenant(tenantId, tx => tx.execute(sql`SELECT p.id,p.key AS code,p.name FROM plans p WHERE p.id = ${subscription?.planId ?? null}::uuid`)) as unknown as Array<{id:string;code:string;name:string}>
 const plan = rows[0] || await getPlanByKey('starter')
 if (!plan) throw new Error('Plan ausente')
 return { ...plan, limits: await getEffectivePlanLimits(tenantId,plan.id) }
}
export async function agentCalendar(tx: Tx, tenantId: string, at = new Date()) {
 const rows = await tx.execute(sql`SELECT (${at.toISOString()}::timestamptz AT TIME ZONE timezone)::date::text AS day,
 date_trunc('month',${at.toISOString()}::timestamptz AT TIME ZONE timezone)::date::text AS month,
 extract(epoch FROM ((date_trunc('day',${at.toISOString()}::timestamptz AT TIME ZONE timezone) + interval '1 day') AT TIME ZONE timezone) - ${at.toISOString()}::timestamptz)::int AS daily_retry,
 extract(epoch FROM ((date_trunc('month',${at.toISOString()}::timestamptz AT TIME ZONE timezone) + interval '1 month') AT TIME ZONE timezone) - ${at.toISOString()}::timestamptz)::int AS monthly_retry
 FROM tenants WHERE id = ${tenantId}::uuid`) as unknown as Array<{ day: string; month: string; daily_retry: number; monthly_retry: number }>
 if (!rows[0]) throw new Error('Organización ausente')
 return rows[0]
}
export async function writeAgentMetric(tx: Tx, auth: AuthTokenPayload, reply: AgentReply, day: string, ai = false, tokensIn = 0, tokensOut = 0) {
 const counts = { navigate: 0, point: 0, 'start-tour': 0 }
 for (const action of reply.actions) counts[action.kind]++
 await tx.execute(sql`INSERT INTO agent_usage (tenant_id,user_id,day,ai_calls,tokens_in,tokens_out,catalog_calls,offtopic_calls,limited_calls,unavailable_calls,messages_total,actions)
 VALUES (${auth.tenantId}::uuid,${auth.sub}::uuid,${day}::date,${ai ? 1 : 0},${tokensIn},${tokensOut},${reply.layer === 'catalog' ? 1 : 0},${reply.layer === 'offtopic' ? 1 : 0},${reply.layer === 'limited' ? 1 : 0},${reply.layer === 'unavailable' ? 1 : 0},1,${JSON.stringify(counts)}::jsonb)
 ON CONFLICT (tenant_id,user_id,day) DO UPDATE SET
 ai_calls = agent_usage.ai_calls + EXCLUDED.ai_calls, tokens_in = agent_usage.tokens_in + EXCLUDED.tokens_in, tokens_out = agent_usage.tokens_out + EXCLUDED.tokens_out,
 catalog_calls = agent_usage.catalog_calls + EXCLUDED.catalog_calls, offtopic_calls = agent_usage.offtopic_calls + EXCLUDED.offtopic_calls,
 limited_calls = agent_usage.limited_calls + EXCLUDED.limited_calls, unavailable_calls = agent_usage.unavailable_calls + EXCLUDED.unavailable_calls,
 messages_total = agent_usage.messages_total + 1, last_used_at = now(), updated_at = now(),
 actions = jsonb_build_object('navigate', (agent_usage.actions->>'navigate')::int + ${counts.navigate}, 'point', (agent_usage.actions->>'point')::int + ${counts.point}, 'start-tour', (agent_usage.actions->>'start-tour')::int + ${counts['start-tour']})`)
}
export async function recordAgentMetric(auth: AuthTokenPayload, reply: AgentReply) {
 try { await withRecordActor({ userId: auth.sub, roleId: auth.roleId }, () => withTenant(auth.tenantId, async tx => { const calendar = await agentCalendar(tx,auth.tenantId); await writeAgentMetric(tx,auth,reply,calendar.day) })) }
 catch { console.warn(JSON.stringify({ event: 'agent_metrics_failed', userId: auth.sub, tenantId: auth.tenantId })) }
}
/** Bloqueo hasta confirmar: sin reservas pendientes que recuperar. */
export async function withAgentQuota(auth: AuthTokenPayload, complete: () => Promise<{ reply: AgentReply; inputTokens: number; outputTokens: number }>, at = new Date()): Promise<AgentReply> {
 const plan = await readAgentPlan(auth.tenantId)
 const limits = plan.limits
 return withRecordActor({ userId: auth.sub, roleId: auth.roleId }, () => withTenant(auth.tenantId, async tx => {
  await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`AGENT_QUOTA:${auth.tenantId}`},0))`)
  const calendar = await agentCalendar(tx,auth.tenantId,at)
  const rows = await tx.execute(sql`SELECT coalesce(sum(ai_calls),0)::int AS monthly, coalesce(sum(ai_calls) FILTER (WHERE user_id=${auth.sub}::uuid AND day=${calendar.day}::date),0)::int AS daily FROM agent_usage WHERE tenant_id=${auth.tenantId}::uuid AND day >= ${calendar.month}::date AND day < (${calendar.month}::date + interval '1 month')`) as unknown as Array<{ monthly: number; daily: number }>
  const usage = rows[0]!
  const monthly = limits.agentQueries !== null && usage.monthly >= limits.agentQueries
  const daily = limits.agentUserDaily !== null && usage.daily >= limits.agentUserDaily
  if (monthly || daily) return { reply: 'Llegamos al límite de consultas con IA. Puedo seguir guiándote con las pantallas y recorridos de Flow.', emotion: 'idle', actions: [], layer: 'limited', retryAfterSec: monthly ? calendar.monthly_retry : calendar.daily_retry }
  const result = await complete()
  // La cuota se confirma en esta transacción; un fallo revierte el conteo.
  try {
   await tx.transaction(async metricTx => writeAgentMetric(metricTx as unknown as Tx,auth,result.reply,calendar.day,true,result.inputTokens,result.outputTokens))
  } catch {
   // Si fallan las métricas accesorias, confirmar al menos la cuota esencial.
   await tx.execute(sql`INSERT INTO agent_usage(tenant_id,user_id,day,ai_calls,tokens_in,tokens_out)
    VALUES(${auth.tenantId}::uuid,${auth.sub}::uuid,${calendar.day}::date,1,${result.inputTokens},${result.outputTokens})
    ON CONFLICT(tenant_id,user_id,day) DO UPDATE SET ai_calls=agent_usage.ai_calls+1,
    tokens_in=agent_usage.tokens_in+EXCLUDED.tokens_in,tokens_out=agent_usage.tokens_out+EXCLUDED.tokens_out,updated_at=now(),last_used_at=now()`)
   console.warn(JSON.stringify({ event: 'agent_metrics_failed', userId: auth.sub, tenantId: auth.tenantId }))
  }
  return result.reply
 }))
}
export async function agentUsageForTenant(tenantId: string, requestedMonth?: string) {
 const plan = await readAgentPlan(tenantId)
 const result = await withTenant(tenantId, async tx => {
  const calendar = await agentCalendar(tx,tenantId)
  const month = requestedMonth ? `${requestedMonth}-01` : calendar.month
  const rows = await tx.execute(sql`SELECT u.id AS "userId", p.full_name AS name, p.email,
 coalesce(sum(a.ai_calls),0)::int AS ai_calls, coalesce(sum(a.messages_total),0)::int AS messages_total,
 coalesce(sum(a.catalog_calls),0)::int AS catalog_calls, coalesce(sum(a.offtopic_calls),0)::int AS offtopic_calls,
 coalesce(sum(a.limited_calls),0)::int AS limited_calls, coalesce(sum(a.unavailable_calls),0)::int AS unavailable_calls,
 max(a.last_used_at) AS last_used_at,
 (SELECT coalesce(sum(today.ai_calls),0)::int FROM agent_usage today WHERE today.tenant_id=u.tenant_id AND today.user_id=u.id AND today.day=${calendar.day}::date) AS daily_calls
 FROM users u JOIN people p ON p.id=u.person_id LEFT JOIN agent_usage a ON a.user_id=u.id AND a.tenant_id=u.tenant_id AND a.day >= ${month}::date AND a.day < (${month}::date + interval '1 month')
 WHERE u.tenant_id=${tenantId}::uuid GROUP BY u.id,p.full_name,p.email ORDER BY ai_calls DESC`) as unknown as Array<{ userId: string; name: string | null; email: string; ai_calls: number; messages_total: number; catalog_calls: number; offtopic_calls: number; limited_calls: number; unavailable_calls: number; last_used_at: string | null; daily_calls: number }>
  return { month: month.slice(0,7), users: rows }
 })
 const limits = plan.limits
 const totals = result.users.reduce((total,row) => ({ ai_calls: total.ai_calls+row.ai_calls, messages_total: total.messages_total+row.messages_total, catalog_calls: total.catalog_calls+row.catalog_calls, offtopic_calls: total.offtopic_calls+row.offtopic_calls, limited_calls: total.limited_calls+row.limited_calls, unavailable_calls: total.unavailable_calls+row.unavailable_calls }),{ ai_calls: 0, messages_total: 0, catalog_calls: 0, offtopic_calls: 0, limited_calls: 0, unavailable_calls: 0 })
 return { ...result, users: result.users.map(row => ({ ...row, last_used_at: row.last_used_at ? new Date(row.last_used_at).toISOString() : null, dailyRemaining: limits.agentUserDaily === null ? null : Math.max(0,limits.agentUserDaily-row.daily_calls) })), totals, plan: plan.name, quota: { agentQueries: limits.agentQueries, agentUserDaily: limits.agentUserDaily, remaining: limits.agentQueries === null ? null : Math.max(0,limits.agentQueries-totals.ai_calls) } }
}
