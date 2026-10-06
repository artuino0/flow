import { sql } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import { db } from '~/server/db'
import { clientIp } from './clientIp'
import { verificationHash } from './verificationCode'
import { consumeAgendaBucket } from './agendaPersistentLimit'

export async function authRequestLimit(event: H3Event, operation: string, account?: string, tenantId?: string) {
  for (const [key, limit] of [[`ip:${clientIp(event)}`, operation === 'otp' ? 30 : 10], ...(account ? [[`account:${account}`, operation === 'otp' ? 15 : 5] as const] : [])] as const) {
    let attempts: number, retryAfter: number
    if (tenantId) ({ attempts, retryAfter } = await consumeAgendaBucket(tenantId, `auth195:${operation}:${key}`, 3600))
    else {
      const rows = await db.execute(sql`select * from consume_auth_security_bucket(${verificationHash('rate', `${operation}:${key}`)},3600)`)
      attempts = Number(rows[0]!.attempts)
      retryAfter = Math.max(1, Math.ceil((new Date(String(rows[0]!.expires_at)).getTime() - Date.now()) / 1000))
    }
    if (attempts > limit) throw createError({ statusCode: 429, statusMessage: 'Demasiadas solicitudes. Intenta más tarde.', data: { retryAfter } })
  }
}
