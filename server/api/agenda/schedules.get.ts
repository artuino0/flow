import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { agendaSchedules } from '~/server/db/schema'
import { agendaActor, agendaPerson, requireAgendaBase, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event), userId = z.string().uuid().parse(getQuery(event).personal ?? auth.sub)
  return withTenant(auth.tenantId, async tx => {
    await requireAgendaBase(tx, auth.tenantId); await agendaPerson(tx, auth.tenantId, userId)
    const rows = await tx.select().from(agendaSchedules).where(and(eq(agendaSchedules.tenantId, auth.tenantId), eq(agendaSchedules.userId, userId))).orderBy(agendaSchedules.weekday, agendaSchedules.startTime)
    return { permissions: await agendaActor(tx, auth, userId), schedules: rows.map(row => ({ ...row, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) })) }
  })
})
