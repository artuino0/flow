import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { consumeRateLimit } from './rateLimit'

export const publicAgendaNotFound = () => createError({ statusCode: 404, statusMessage: 'Agenda no disponible.', stack: '' })
export function agendaHash(value: string) { return createHash('sha256').update(value).digest('hex') }
export function agendaOpaqueId(site: string, kind: 'person' | 'service', id: string) { return agendaHash(`${site}:${kind}:${id}`).slice(0, 32) }
export function newAgendaToken() { return randomBytes(32).toString('base64url') }
export function agendaServerSecret() {
  const secret = process.env.JWT_SECRET
  if (secret) return createHmac('sha256', secret).update('flow:agenda:security:v190').digest()
  if (process.env.NODE_ENV === 'production') throw new Error('Falta el secreto estable de Agenda')
  return createHash('sha256').update('flow:agenda:local-development-only:v190').digest()
}
export function agendaFormToken(site: string, page: string, now = Date.now()) {
  const payload = `${now}.${randomBytes(12).toString('hex')}`
  return `${payload}.${createHmac('sha256', agendaServerSecret()).update(`${site}:${page}:${payload}`).digest('hex')}`
}
export function validAgendaFormToken(token: string, site: string, page: string, now = Date.now()) {
  const [issued, nonce, signature, extra] = token.split('.')
  if (extra || !issued || !nonce || !signature || !/^\d{13}$/.test(issued) || !/^[a-f0-9]{24}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false
  const elapsed = now - Number(issued)
  const expected = createHmac('sha256', agendaServerSecret()).update(`${site}:${page}:${issued}.${nonce}`).digest('hex')
  return elapsed >= 2000 && elapsed <= 7200000 && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
export function agendaRequestLimit(operation: string, ip: string, site: string, contacts: string[] = [], now = Date.now()) {
  const read = operation === 'slots' || operation === 'booking'
  const keys: [string, number][] = [[`agenda:${operation}:ip:${agendaHash(ip)}`, read ? 60 : 10], [`agenda:${operation}:site:${site}`, read ? 300 : 100],
    ...contacts.filter(Boolean).map(contact => [`agenda:contact:${agendaHash(contact)}`, 5] as [string, number])]
  for (const [key, limit] of keys) {
    const status = consumeRateLimit(key, limit, 15 * 60000, now)
    if (status.blocked) throw createError({ statusCode: 429, statusMessage: 'Demasiadas solicitudes. Intenta más tarde.', data: { retryAfter: status.retryAfterSeconds } })
  }
}
export function canManageAgenda(start: number | null, cancellationHours: number, now = Date.now()) {
  return start !== null && start > now && start - now >= cancellationHours * 3600000
}
