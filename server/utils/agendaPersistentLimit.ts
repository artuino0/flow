import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createError } from 'h3'
import { withTenant } from '~/server/db'
import { consumeRateLimit } from './rateLimit'
import { agendaServerSecret } from './agendaPublicSecurity'
import { logger } from './logger'
import type { PublicAgendaContext } from './agendaPublic'

export function agendaPrivateKey(value: string) { return createHmac('sha256', agendaServerSecret()).update(value).digest('hex') }
export async function consumeAgendaBucket(tenant: string, key: string, seconds: number, now = Date.now()) {
  return withTenant(tenant, async tx => {
    await tx.execute(sql`select set_config('statement_timeout','500ms',true),set_config('lock_timeout','300ms',true)`)
    const rows = await tx.execute(sql`insert into agenda_security_buckets(tenant_id,key_hash,attempts,expires_at)
      values (${tenant}::uuid,${agendaPrivateKey(key)},1,${new Date(now + seconds * 1000).toISOString()}::timestamptz)
      on conflict(tenant_id,key_hash) do update set
        attempts=case when agenda_security_buckets.expires_at <= ${new Date(now).toISOString()}::timestamptz then 1 else least(agenda_security_buckets.attempts+1,1000000) end,
        expires_at=case when agenda_security_buckets.expires_at <= ${new Date(now).toISOString()}::timestamptz then excluded.expires_at else agenda_security_buckets.expires_at end
      returning attempts,expires_at`)
    return { attempts: Number(rows[0]!.attempts), retryAfter: Math.max(1, Math.ceil((new Date(String(rows[0]!.expires_at)).getTime() - now) / 1000)) }
  })
}
export function agendaSecurityEvent(site: string, reason: 'rate_limit' | 'database_fallback' | 'turnstile_invalid' | 'turnstile_unavailable' | 'confirmation_expired') {
  logger.warn('agenda_security', { site, reason })
}
function blocked(context: PublicAgendaContext, retryAfter: number): never {
  agendaSecurityEvent(context.site, 'rate_limit')
  throw createError({ statusCode: 429, statusMessage: 'Demasiadas solicitudes. Intenta más tarde.', data: { retryAfter } })
}
export async function persistentAgendaLimit(context: PublicAgendaContext, operation: string, contacts: string[] = [], strict = false, now = Date.now()) {
  const read = operation === 'slots' || operation === 'booking'
  const keys: [string, number][] = [[`${operation}:ip:${context.fingerprint}`, read ? 60 : strict ? 2 : 10], [`${operation}:site:${context.site}`, read ? 300 : strict ? 20 : 100],
    ...contacts.filter(Boolean).map(contact => [`contact:${contact}`, strict ? 1 : 5] as [string, number])]
  for (const [key, limit] of keys) {
    let status: { attempts: number; retryAfter: number }
    try { status = await consumeAgendaBucket(context.tenantId, key, 900, now) }
    catch {
      agendaSecurityEvent(context.site, 'database_fallback')
      // Sin persistencia no se acepta sin protección: tope menor, mapa acotado.
      const fallback = consumeRateLimit(`agenda190:fallback:${context.tenantId}:${agendaPrivateKey(key)}`, read ? Math.min(limit, 30) : Math.min(limit, key.startsWith('contact:') ? 1 : 2), 900000, now)
      if (fallback.blocked) blocked(context, fallback.retryAfterSeconds)
      continue
    }
    if (status.attempts > limit) blocked(context, status.retryAfter)
  }
}
