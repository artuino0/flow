import { sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { db } from '~/server/db'
import type { AuthTokenPayload } from './auth'
import { agendaActor } from './agendaAdmin'
export async function setAgendaForce(tx: typeof db, auth: AuthTokenPayload, reason?: string) {
  if (!reason) return
  if (!(await agendaActor(tx, auth, null)).force) throw createError({ statusCode: 403, statusMessage: 'Solo un administrador puede forzar un traslape.' })
  await tx.execute(sql`select set_config('app.agenda_force_reason',${reason},true)`)
}
export function agendaDatabaseError(error: unknown): never {
  let cause: unknown = error
  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    const detail = cause as { code?: string; message?: string; cause?: unknown }
    if (detail.code === '23P01') throw createError({ statusCode: 409, statusMessage: 'Hueco ya ocupado: el personal tiene una cita que se traslapa.' })
    if (detail.code === '23514' && /Personal inválido|Hora inválida|Duración inválida|hora no existe/.test(detail.message ?? '')) throw createError({ statusCode: 422, statusMessage: detail.message })
    cause = detail.cause
  }
  throw error
}
