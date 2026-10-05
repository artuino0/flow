import { createError } from 'h3'
import { consumeAgendaBucket, persistentAgendaLimit, agendaSecurityEvent } from './agendaPersistentLimit'
import type { PublicAgendaContext } from './agendaPublic'
import type { AgendaSiteConfig } from '~/utils/agendaPublic'

export function agendaTurnstileKey(config: Pick<AgendaSiteConfig, 'botProtection'>) {
  if (config.botProtection === 'disabled' && process.env.TURNSTILE_ALLOW_DISABLED === 'true') return undefined
  return process.env.TURNSTILE_SITE_KEY?.trim() && process.env.TURNSTILE_SECRET_KEY?.trim() ? process.env.TURNSTILE_SITE_KEY.trim() : undefined
}
export async function verifyAgendaTurnstile(context: PublicAgendaContext, config: AgendaSiteConfig, action: 'book' | 'cancel' | 'reschedule', token?: string, now = Date.now()) {
  if (!agendaTurnstileKey(config)) return
  if (action !== 'book') {
    let risk: number
    try { risk = (await consumeAgendaBucket(context.tenantId, `risk:${context.site}:${context.fingerprint}`, 900, now)).attempts }
    catch { risk = 4 }
    if (risk <= 3) return
  }
  const invalid = () => {
    agendaSecurityEvent(context.site, 'turnstile_invalid')
    throw createError({ statusCode: 422, statusMessage: 'Solicitud inválida.', data: { challengeRequired: true } })
  }
  if (token && token.length > 2048 || action !== 'book' && !token) invalid()
  // Se reclama antes de llamar al proveedor, entre todas las instancias.
  try { if (token && (await consumeAgendaBucket(context.tenantId, `turnstile:${token}`, 600, now)).attempts !== 1) invalid() }
  catch (error) { if ((error as { statusCode?: number }).statusCode === 422) throw error; return unavailable() }
  async function unavailable() {
    agendaSecurityEvent(context.site, 'turnstile_unavailable')
    if (config.turnstileOutage === 'deny') return invalid()
    await persistentAgendaLimit(context, `outage:${action}`, [], true, now)
  }
  let result: { success?: boolean; hostname?: string; action?: string }
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token ?? '' }), signal: AbortSignal.timeout(2500) })
    if (!response.ok) return unavailable()
    result = await response.json() as typeof result
  } catch { return unavailable() }
  if (!token || !result || result.success !== true || typeof result.hostname !== 'string' || result.hostname.toLowerCase() !== new URL(context.origin).hostname.toLowerCase() || result.action !== action) invalid()
}
