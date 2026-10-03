import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { agendaTimeOff } from '~/server/db/schema'
import { agendaActor, requireAgendaBase, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  return withTenant(auth.tenantId, async tx => {
    await requireAgendaBase(tx, auth.tenantId)
    return { permissions: await agendaActor(tx, auth, auth.sub), blocks: (await tx.select().from(agendaTimeOff).where(eq(agendaTimeOff.tenantId, auth.tenantId)).orderBy(agendaTimeOff.startLocal)).map(row => ({ ...row, startLocal: row.startLocal.replace(' ', 'T').slice(0, 16), endLocal: row.endLocal.replace(' ', 'T').slice(0, 16) })) }
  })
})
