import { createError, getHeader, getQuery, setResponseHeader, type H3Event } from 'h3'
import { z } from 'zod'
import { effectiveRequestHost } from './effectiveHost'
import { agendaRequestLimit, publicAgendaNotFound } from './agendaPublicSecurity'
import { resolveAgendaContext } from './agendaPublic'

export async function readAgendaBody(event: H3Event): Promise<unknown> {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) throw createError({ statusCode: 422, statusMessage: 'Solicitud inválida.' })
  const chunks: Buffer[] = []
  let size = 0
  if (Number(getHeader(event, 'content-length') ?? 0) > 16384) throw createError({ statusCode: 413, statusMessage: 'Solicitud demasiado grande.' })
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 16384) throw createError({ statusCode: 413, statusMessage: 'Solicitud demasiado grande.' })
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw createError({ statusCode: 422, statusMessage: 'Solicitud inválida.' }) }
}
export async function agendaHttp<T>(event: H3Event, operation: string, fn: () => Promise<T>): Promise<T> {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  try { return await fn() } catch (error) {
    if (error instanceof z.ZodError) {
      if (['booking', 'cancel', 'reschedule'].includes(operation) && error.issues.some(issue => issue.path[0] === 'token')) throw publicAgendaNotFound()
      throw createError({ statusCode: 422, statusMessage: 'Solicitud inválida.', stack: '' })
    }
    const value = error as { statusCode?: number; code?: string; cause?: { code?: string }; data?: { retryAfter?: number } }
    if (value.statusCode === 429) {
      setResponseHeader(event, 'Retry-After', value.data?.retryAfter ?? 900)
      throw createError({ statusCode: 429, statusMessage: 'Demasiadas solicitudes. Intenta más tarde.', stack: '' })
    }
    if (value.statusCode === 404) throw publicAgendaNotFound()
    if (value.statusCode === 409 || (value.code ?? value.cause?.code) === '23P01') throw createError({ statusCode: 409, statusMessage: operation === 'cancel' ? 'Ya no es posible cambiar esta cita.' : 'El horario no está disponible o ya no admite cambios. Elige otro horario.', stack: '' })
    if (value.statusCode === 413) throw createError({ statusCode: 413, statusMessage: 'Solicitud demasiado grande.', stack: '' })
    if (value.statusCode === 422) throw createError({ statusCode: 422, statusMessage: 'Solicitud inválida.', stack: '' })
    throw createError({ statusCode: 500, statusMessage: 'No se pudo completar la solicitud.', stack: '' })
  }
}
export function agendaQuery(event: H3Event) { return getQuery(event) }
export async function agendaHttpContext(event: H3Event, operation: string, input: { site: string; page: string; client?: { email: string; phone: string } }) {
  // IP del socket: cabeceras reenviadas no confiables no sirven para eludir el
  // bucket. En un proxy varios visitantes comparten IP (límite conservador).
  const ip = event.node.req.socket.remoteAddress ?? 'unknown'
  agendaRequestLimit(operation, ip, input.site, input.client ? [input.client.email, input.client.phone] : [])
  const host = effectiveRequestHost(event, false)
  const origin = getHeader(event, 'origin') || (() => {
    // GET de mismo origen no lleva Origin en todos los navegadores; exigir
    // Referer válido y comprobarlo contra Host, sin confiar en href del cuerpo.
    try { return new URL(getHeader(event, 'referer') ?? '').origin } catch { return '' }
  })()
  return resolveAgendaContext(input.site, input.page, { host, origin, ip, userAgent: getHeader(event, 'user-agent') ?? '' })
}
