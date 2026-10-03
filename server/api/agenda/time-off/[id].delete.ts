import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { agendaTimeOff } from '~/server/db/schema'
import { agendaActor, agendaMutationLock, requireAgendaBase, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event), id = z.string().uuid().parse(getRouterParam(event, 'id'))
  return withTenant(auth.tenantId, async tx => {
    await requireAgendaBase(tx, auth.tenantId); await agendaMutationLock(tx, auth.tenantId)
    const where = and(eq(agendaTimeOff.id, id), eq(agendaTimeOff.tenantId, auth.tenantId))
    const [row] = await tx.select().from(agendaTimeOff).where(where).limit(1)
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Bloqueo no encontrado.' })
    if (!(await agendaActor(tx, auth, row.userId)).edit) throw createError({ statusCode: 403, statusMessage: 'No puedes eliminar este bloqueo.' })
    await tx.delete(agendaTimeOff).where(where)
    return { ok: true }
  })
})
